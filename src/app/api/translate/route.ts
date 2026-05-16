import { NextRequest, NextResponse } from "next/server";
import {
  ISLAMIC_TERMINOLOGY_RULES,
  ISLAMIC_FEW_SHOT_EXAMPLES,
} from "@/lib/islamic-terminology";
import { requireAuthFromHeader, checkRateLimit } from "@/lib/api-auth";

interface TranslateRequest {
  text: string;
  source?: string;
  target: string;
  /**
   * Recent prior segments (sourceText + optional translatedText) sent for
   * disambiguation only. The model is instructed never to translate or
   * include these in its output — they exist solely so a short ambiguous
   * `text` is interpreted in the surrounding flow rather than in isolation.
   *
   * Each entry carries the segment's stable `id` so the model can refer
   * to specific prior segments in a verse/hadith merge directive (see the
   * `<<<MERGE>>>` protocol below).
   */
  context?: { id: string; sourceText: string; translatedText?: string }[];
}

interface MergeDirective {
  /** IDs from `context` that this segment should absorb. */
  fromIds: string[];
  /** Full source (Arabic verse, hadith text) — children + this concatenated. */
  combinedSourceText: string;
  /** Full translation with the citation. */
  combinedTranslatedText: string;
}

interface AnthropicResponse {
  content?: { type: string; text: string }[];
  error?: { message?: string; type?: string };
  // Surfaced when prompt caching kicks in. Useful for cost telemetry once the
  // system prompt grows past Haiku's 2048-token cache-eligibility threshold.
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
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

function languageName(code: string | undefined): string {
  if (!code) return "the source language";
  return LANGUAGE_NAMES[code] ?? code;
}

function buildUserMessage(opts: {
  text: string;
  sourceName: string;
  targetName: string;
  context?: { id: string; sourceText: string; translatedText?: string }[];
}): string {
  const { text, sourceName, targetName, context } = opts;
  const hasContext = Array.isArray(context) && context.length > 0;

  if (!hasContext) {
    return `Translate from ${sourceName} to ${targetName}:\n\n${text}`;
  }

  const contextLines = context!
    .map((c) => {
      const src = c.sourceText.trim();
      const tr = c.translatedText?.trim();
      return tr
        ? `  [id=${c.id}] ${sourceName}: ${src}\n             ${targetName}: ${tr}`
        : `  [id=${c.id}] ${sourceName}: ${src}`;
    })
    .join("\n");

  return `Context (prior segments — for disambiguation only, do NOT include in your output):
${contextLines}

Now translate ONLY this segment from ${sourceName} to ${targetName} (output the translation only):
${text}`;
}

// Split the model's output into the plain translation text + an optional
// merge directive. The model writes the merge as a JSON object on the line
// immediately after a single `<<<MERGE>>>` marker — see the system prompt.
// If parsing the marker fails for any reason, we treat the whole output
// as the translation and skip the merge silently.
const MERGE_MARKER = "<<<MERGE>>>";

function parseMergeDirective(
  raw: string,
  validContextIds: Set<string>
): { translation: string; merge?: MergeDirective } {
  const idx = raw.indexOf(MERGE_MARKER);
  if (idx === -1) return { translation: raw.trim() };

  const translation = raw.slice(0, idx).trim();
  const mergeJson = raw.slice(idx + MERGE_MARKER.length).trim();

  try {
    const parsed = JSON.parse(mergeJson) as unknown;
    if (!parsed || typeof parsed !== "object") return { translation };
    const obj = parsed as Record<string, unknown>;
    const fromIds = Array.isArray(obj.fromIds)
      ? (obj.fromIds as unknown[]).filter(
          (x): x is string => typeof x === "string"
        )
      : [];
    const combinedSourceText =
      typeof obj.combinedSourceText === "string" ? obj.combinedSourceText : "";
    const combinedTranslatedText =
      typeof obj.combinedTranslatedText === "string"
        ? obj.combinedTranslatedText
        : "";
    if (
      fromIds.length === 0 ||
      !combinedSourceText ||
      !combinedTranslatedText
    ) {
      return { translation };
    }
    // Sanity check: only honor merge ids the client actually sent as context.
    // Defends against hallucinated ids.
    const safeFromIds = fromIds.filter((id) => validContextIds.has(id));
    if (safeFromIds.length === 0) return { translation };
    return {
      translation,
      merge: {
        fromIds: safeFromIds,
        combinedSourceText,
        combinedTranslatedText,
      },
    };
  } catch {
    return { translation };
  }
}

// Translation system prompt. The Islamic-terminology rules are the whole
// reason this app uses an LLM (instead of Google Translate) — Google flattens
// "Allah" → "God" and strips honorifics, which is unacceptable for the
// khutbah audience. The shared rules + few-shot examples are pulled in from
// a module so /api/summarize uses identical guidance.
//
// `cache_control: ephemeral` is set on this block below; the prompt is
// large enough to comfortably exceed Haiku's 2048-token cache threshold,
// so subsequent calls within a 5-minute window pay ~10% of input cost.
const SYSTEM_PROMPT = `You are a translation engine for a live transcription app used by Sunni Muslim audiences for Islamic sermons (khutbahs), lectures, classes, Quranic study, and religious talks. Interpret all Islamic content within the framework of Ahl as-Sunnah wal-Jama'ah following the methodology of the Salaf as-Salih (the righteous predecessors). Translate the user's text from the source language to the target language and output ONLY the translation — no preamble, no commentary, no quotation marks, no language labels.

## General rules
- Output ONLY the translation. Never address the user. Never include notes, warnings, parentheticals about input quality, requests for clarification, or any text that is not itself a translation of the input.
- Match the register of the source. Formal Arabic (MSA / classical) → formal English. Conversational → conversational.
- Input may be a fragment or mid-sentence — this is a live transcription app, so the speaker hasn't finished. Translate fragments as fragments. If a word is cut off mid-syllable, translate what's there and end with "..." rather than commenting on the cut.
- If the input is already in the target language, output it unchanged.
- If the input is empty, gibberish, or genuinely untranslatable, output an empty string (do not invent translations of noise, do not explain why).
- The Islamic-terminology rules below apply REGARDLESS of source language. They fire whenever Islamic content is present — Arabic→English, English→Urdu, Turkish→French, etc.

## Context handling
- The user message may contain a "Context (prior segments)" block before the segment to translate. That context exists ONLY for disambiguation — to give you the surrounding flow when the current segment is short or ambiguous.
- NEVER translate or include any context segment in your output. Output only the translation of the explicitly-marked current segment.
- Use context to resolve pronouns, gendered references, continuation phrases, and to choose terminology consistent with what came before.

## Verse / hadith continuation merging (IMPORTANT)
If the current segment, COMBINED with one or more immediately-preceding context segments, completes a Quranic verse or authentic hadith you recognize with 100% certainty, emit a MERGE DIRECTIVE so the client can collapse the prior segments and this one into a single message.

Format:
1. First, output the translation of just the current segment as normal plain text (this stays the same as without a merge).
2. Then append, on a new line, the exact marker:
   <<<MERGE>>>
3. Immediately after the marker, output a single-line JSON object with exactly these three keys:
   {"fromIds":["<id1>","<id2>"],"combinedSourceText":"<full source verse/hadith>","combinedTranslatedText":"<full translation with citation>"}

Rules:
- Only merge when the combined text IS a complete, well-known Quranic verse or hadith from the six authentic Sunni collections (Bukhari, Muslim, Abu Dawud, Tirmidhi, Nasa'i, Ibn Majah). When in doubt, do NOT emit the merge — better to miss a merge than create a false one.
- \`fromIds\` must contain only ids from the Context block. Each id was given as \`[id=<value>]\`. Use those exact strings.
- \`fromIds\` must be IMMEDIATELY CONSECUTIVE in the context (don't skip over unrelated segments in the middle).
- \`combinedSourceText\` is the full source-language text of the merged-from segments + the current segment concatenated with a single space.
- \`combinedTranslatedText\` is the full target-language translation of the verse/hadith with the standard inline citation (e.g., \`[Quran Al-Ahzab:56]\` or \`[Sahih al-Bukhari, Hadith 1]\`).
- LENGTH CAP: only emit a merge when \`combinedTranslatedText\` is under approximately 600 characters. For very long verses (e.g., Ayat al-Kursi as a whole), let them stay split for readability.
- If you don't want to merge, simply omit the \`<<<MERGE>>>\` block — output just the plain translation as before.

Example merge output (NEVER actually translate this way unless the current segment really completes a verse):
The full English translation here with citation. [Quran X:Y]
<<<MERGE>>>
{"fromIds":["seg-abc-1"],"combinedSourceText":"<full Arabic>","combinedTranslatedText":"The full English translation here with citation. [Quran X:Y]"}

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

  // 1. Authenticate. Without this, anyone who finds the route URL can
  //    drain the Anthropic budget — see /Users/ard/.claude/plans/...
  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to use translation." },
      { status: 401 }
    );
  }

  // 2. Per-user rate limit (60/min token bucket).
  const limit = checkRateLimit(auth.userId, "translate");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Translation rate limit hit. Try again in ${limit.retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      }
    );
  }

  let body: TranslateRequest;
  try {
    body = (await req.json()) as TranslateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, source, target, context } = body;
  if (!text || typeof text !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `text`" },
      { status: 400 }
    );
  }
  if (!target || typeof target !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `target` language code" },
      { status: 400 }
    );
  }

  // No-op when source === target. Skipping the upstream call avoids both
  // unnecessary cost and unnecessary latency.
  if (source && source === target) {
    return NextResponse.json({ translatedText: text });
  }

  const sourceName = languageName(source);
  const targetName = languageName(target);

  // 15s timeout. Anthropic Haiku usually responds in 0.3–1.5s for short
  // segments; anything beyond 15s indicates upstream trouble and we'd
  // rather fail fast than hang the user's transcript indefinitely.
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: buildUserMessage({
              text,
              sourceName,
              targetName,
              context,
            }),
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timed out|abort/i.test(msg)) {
      return NextResponse.json(
        { error: "Translation timed out. Try again." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Translation failed: ${msg}` },
      { status: 502 }
    );
  }

  const data = (await response.json().catch(() => ({}))) as AnthropicResponse;

  if (!response.ok || data.error) {
    const detail = data.error?.message ?? `HTTP ${response.status}`;
    return NextResponse.json(
      { error: `Translation failed: ${detail}` },
      { status: 502 }
    );
  }

  const rawText = data.content?.find((b) => b.type === "text")?.text;
  if (typeof rawText !== "string") {
    return NextResponse.json(
      { error: "Translator returned no text" },
      { status: 502 }
    );
  }

  // Split the model's output into translation + optional merge directive.
  // Sanity-check merge ids against what the client actually sent so a
  // hallucinated id can't break the client's segment state.
  const validContextIds = new Set<string>(
    (context ?? []).map((c) => c.id).filter((id): id is string => !!id)
  );
  const parsed = parseMergeDirective(rawText, validContextIds);

  return NextResponse.json({
    translatedText: parsed.translation,
    ...(parsed.merge ? { merge: parsed.merge } : {}),
  });
}
