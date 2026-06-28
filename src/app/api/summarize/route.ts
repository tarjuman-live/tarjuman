import { NextRequest, NextResponse } from "next/server";
import {
  ISLAMIC_TERMINOLOGY_RULES,
  ISLAMIC_FEW_SHOT_EXAMPLES,
} from "@/lib/islamic-terminology";
import {
  requireAuthFromHeader,
  checkRateLimit,
  getUsageFromHeader,
} from "@/lib/api-auth";

interface SummarizeRequest {
  transcript: string;
  targetLanguage?: string;
  context?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  // Tier 1
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  ru: "Russian",
  hi: "Hindi",
  ja: "Japanese",
  // Tier 2
  ar: "Arabic",
  ko: "Korean",
  zh: "Chinese",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  tr: "Turkish",
  pl: "Polish",
  cs: "Czech",
  hu: "Hungarian",
  no: "Norwegian",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  el: "Greek",
  he: "Hebrew",
  ro: "Romanian",
  ca: "Catalan",
  uk: "Ukrainian",
};

const SYSTEM_PROMPT = `You are an expert summarizer for Sunni Muslim audiences on Islamic content — sermons (khutbahs), lectures, classes, Quranic study, and religious talks. Interpret all content within the framework of Ahl as-Sunnah wal-Jama'ah following the methodology of the Salaf as-Salih (the righteous predecessors). Avoid sectarian, modernist, or innovative readings.

When summarizing:
- Use the SAME Islamic terminology in your summary that you'd use for translation. The terminology rules below apply equally to summary output, REGARDLESS of source language — they fire whenever Islamic content is present.
- Match the speaker's tradition — if they reference Sahaba by Arabic name, use those names; if they cite Quranic verses, preserve surah/ayah references.
- Don't soften or genericize Islamic concepts (don't replace "Allah" with "God," don't replace "Sabr" with "patience" — the audience prefers the term they'd hear in the lecture).
- Apply the conservative citation policy: cite Quran verses and hadith ONLY when certain of the exact source. Never fabricate references.

${ISLAMIC_TERMINOLOGY_RULES}

${ISLAMIC_FEW_SHOT_EXAMPLES}`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to generate summaries." },
      { status: 401 }
    );
  }

  const limit = checkRateLimit(auth.userId, "summarize");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Summary rate limit hit. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  // Plan cost gate: a free user who's used their monthly summary quota can't
  // call Claude. Fail open if usage can't be read (reactive UI is primary gate).
  const usage = await getUsageFromHeader(req);
  if (usage && !usage.canSummarize) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.summariesLimit} free summaries this month. Upgrade to Tarjuman Pro for unlimited AI summaries.`,
        code: "limit_reached",
      },
      { status: 402 }
    );
  }

  let body: SummarizeRequest;
  try {
    body = (await req.json()) as SummarizeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { transcript, targetLanguage = "en", context } = body;
  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `transcript`" },
      { status: 400 }
    );
  }
  // Outer size cap. Even a 6h dars transcript (the longest supported session)
  // is comfortably under this; a much larger body is abuse — forwarding a giant
  // input to Claude in a loop to burn budget — so reject it before the upstream
  // call rather than amplifying cost.
  if (transcript.length > 400_000) {
    return NextResponse.json(
      { error: "Transcript too long to summarize." },
      { status: 413 }
    );
  }

  const targetLangName = LANGUAGE_NAMES[targetLanguage] ?? "English";

  const userMessage = `Summarize the live-transcribed content below${
    context ? ` (${context})` : ""
  }. The transcript may contain transcription errors — use context to interpret unclear words.

Write the summary in ${targetLangName}, using the Islamic-terminology rules from the system prompt.

Format as markdown with the following sections, using H2 (\`##\`) headings:

## Main Topic
1-2 sentences on what this was about.

## Key Points
Bulleted list of the most important points, preserving Islamic vocabulary.

## Action Items / Takeaways
Practical advice or calls to action mentioned (omit this section entirely if none were given).

## Notable Quotes
Memorable statements, hadith, or Quranic references with attribution. **EVERY quote in this section MUST have a specific citation in parentheses** — e.g., \`(Quran Surah:Ayah)\` for verses, \`(Sahih al-Bukhari 3367)\` for hadith (sunnah.com numbering). If you cannot provide a specific, verifiable citation, OMIT that quote entirely rather than including it with a vague reference like "a well-known narration on X." Better to have fewer fully-cited quotes than more quotes with weak attribution. Omit this section entirely if no fully-citable quotes exist.

Do NOT include a top-level title like "# Summary" — the UI already labels this section. Start directly with the first \`##\` heading.

Keep it concise but comprehensive.

TRANSCRIPT:
${transcript}`;

  // Open a streaming connection to Anthropic.
  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Haiku 4.5 for summaries. Measured 2026-06-24 on the same prompt:
        // Haiku TTFT ~1.3s / ~4.5s total vs Sonnet 4.6 ~4.9s / ~13.7s (≈3x
        // faster) — Sonnet sat ~5s before the first character, which read as a
        // dead spinner. The locked Islamic-quality bar is held by (a) the same
        // terminology rules in the system prompt that translation (also Haiku
        // 4.5) uses and (b) the sunnah.com /api/verify-citations pass that
        // strips/repairs hallucinated hadith numbers. Revert to
        // "claude-sonnet-4-6" here if a long-lecture summary regresses.
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        stream: true,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userMessage }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Summary failed: ${msg}` },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    // Log the provider body server-side; return a generic message so Anthropic
    // diagnostics (model ids / account hints) aren't echoed to the client.
    const errText = await upstream.text().catch(() => "");
    console.error(
      `[summarize] upstream HTTP ${upstream.status}: ${errText.slice(0, 300)}`
    );
    return NextResponse.json(
      { error: "Summary temporarily unavailable." },
      { status: 502 }
    );
  }

  // Parse Anthropic's SSE stream and re-emit just the text deltas
  // as plain UTF-8 chunks the browser can read directly.
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json || json === "[DONE]") continue;
            try {
              const evt = JSON.parse(json);
              if (
                evt.type === "content_block_delta" &&
                evt.delta?.type === "text_delta" &&
                typeof evt.delta.text === "string"
              ) {
                controller.enqueue(encoder.encode(evt.delta.text));
              }
            } catch {
              // ignore malformed line
            }
          }
        }
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}