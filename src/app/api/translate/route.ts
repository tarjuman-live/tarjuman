import { NextRequest, NextResponse } from "next/server";
import {
  ISLAMIC_TERMINOLOGY_RULES,
  ISLAMIC_FEW_SHOT_EXAMPLES,
} from "@/lib/islamic-terminology";
import { requireAuthFromHeader, checkRateLimit } from "@/lib/api-auth";
import { verifyAndEnrich } from "@/lib/sunnah";
import { verifyAndEnrichQuran } from "@/lib/quran";
import { isOffLanguageScript } from "@/lib/script";

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

// ─── Model routing ─────────────────────────────────────────────────────────
// Haiku 4.5 is the default — fast and cheap, great for mechanical translation
// with the terminology rules. Sonnet 4.6 takes over only when the segment
// looks like Quran/hadith content (where recognition + citation accuracy
// matter and Haiku reliably misses references). Average khutbah ends up
// ~85% Haiku / ~15% Sonnet → ~1.6× cost vs Haiku-only, much cheaper than
// going all-Sonnet.

const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const MODEL_SONNET = "claude-sonnet-4-6";

// Arabic markers that suggest hadith narration. Includes common isnad
// openers and the most-cited companion narrators.
const HADITH_MARKERS_AR: RegExp[] = [
  /قال\s+النبي/,
  /قال\s+رسول\s+الله/,
  /قال\s+صلى\s+الله\s+عليه\s+وسلم/,
  /عن\s+(?:أبي|ابن|أنس|عائشة|عمر|علي|عثمان|أبو|سعد|جابر|بريدة)/,
  /روى\s+(?:البخاري|مسلم|أبو|الترمذي|النسائي|ابن|الإمام|أحمد|مالك|الحاكم|البيهقي)/,
  /حدثنا/,
  /أخبرنا/,
];

const QURAN_MARKERS_AR: RegExp[] = [
  /قال\s+الله\s+(?:تعالى|عز\s+وجل|سبحانه)/,
  /في\s+سورة/,
  /(?:سورة|الآية|آية)\s+/,
];

// English source: speaker is delivering an Islamic lecture in English and
// citing/quoting verses or hadiths.
const HADITH_MARKERS_EN: RegExp[] = [
  /\bthe\s+prophet\s+(?:muhammad\s+)?(?:said|narrated|reported|told|taught)/i,
  /\b(?:narrated|reported)\s+by\b/i,
  /\bsahih\s+(?:al-)?bukhari\b/i,
  /\bsahih\s+muslim\b/i,
  /\bsunan\s+(?:abi\s+dawud|at-?tirmidhi|an-?nasa|ibn\s+majah)/i,
  /\bmuwatta\b/i,
];

const QURAN_MARKERS_EN: RegExp[] = [
  /\ballah\s+(?:says?|said|stated)/i,
  /\bin\s+(?:surah|surat)\b/i,
  /\bquran\b/i,
  /\bayah\b/i,
];

const ALL_MARKERS: RegExp[] = [
  ...HADITH_MARKERS_AR,
  ...QURAN_MARKERS_AR,
  ...HADITH_MARKERS_EN,
  ...QURAN_MARKERS_EN,
];

// Citation patterns in a prior translation that signal "context was about
// Quran/hadith" — escalate continuations to Sonnet too so a verse split
// across multiple breaths gets the same model for clean merge.
const TRANSLATION_CITATION_RE =
  /[[(]\s*(?:Quran|Sahih|Sunan|Jami|Muwatta|Musnad)/i;

function looksLikeIslamicCitation(text: string): boolean {
  if (!text) return false;
  for (const re of ALL_MARKERS) if (re.test(text)) return true;
  return false;
}

function routeModel(
  text: string,
  context: TranslateRequest["context"]
): string {
  if (looksLikeIslamicCitation(text)) return MODEL_SONNET;
  if (Array.isArray(context)) {
    for (const c of context) {
      if (looksLikeIslamicCitation(c.sourceText)) return MODEL_SONNET;
      if (c.translatedText && TRANSLATION_CITATION_RE.test(c.translatedText))
        return MODEL_SONNET;
    }
  }
  return MODEL_HAIKU;
}

// ─── Noise filter ──────────────────────────────────────────────────────────
// Drop segments before they ever hit the LLM:
//   1. Fewer than 3 words — single-word interjections like "اجمعين" are noise.
//   2. Off-language by script — non-source-script text in an RTL session (e.g.
//      English in an Arabic session, now visible as Latin thanks to Deepgram
//      multilingual mode). Server-side backstop to the client gate in
//      use-deepgram; both share src/lib/script.ts.

function shouldFilterAsNoise(
  text: string,
  sourceLang: string | undefined
): { filter: boolean; reason?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { filter: true, reason: "empty" };

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3) {
    return { filter: true, reason: `too-short (${wordCount} word(s))` };
  }

  if (isOffLanguageScript(trimmed, sourceLang)) {
    return { filter: true, reason: "off-language-script" };
  }

  return { filter: false };
}

function buildUserMessage(opts: {
  text: string;
  sourceName: string;
  targetName: string;
  context?: { id: string; sourceText: string; translatedText?: string }[];
}): string {
  const { text, sourceName, targetName, context } = opts;
  const hasContext = Array.isArray(context) && context.length > 0;

  const contextBlock = hasContext
    ? `Context (prior segments — for disambiguation only, do NOT include in your output):
${context!
  .map((c) => {
    const src = c.sourceText.trim();
    const tr = c.translatedText?.trim();
    return tr
      ? `  [id=${c.id}] ${sourceName}: ${src}\n             ${targetName}: ${tr}`
      : `  [id=${c.id}] ${sourceName}: ${src}`;
  })
  .join("\n")}

`
    : "";

  if (!hasContext) {
    return `Translate from ${sourceName} to ${targetName}:\n\n${text}`;
  }

  return `${contextBlock}Now translate ONLY this segment from ${sourceName} to ${targetName} (output the translation only):
${text}`;
}

// Split the model's output into the plain translation text + an optional
// merge directive. The model writes the merge as a JSON object on the line
// immediately after a single `<<<MERGE>>>` marker — see the system prompt.
// If parsing the marker fails for any reason, we treat the whole output
// as the translation and skip the merge silently.
const MERGE_MARKER = "<<<MERGE>>>";

// Separates the streamed plain-translation text from the final metadata JSON
// trailer (enriched text + merge/filtered/error). The U+241E control char can
// never appear in translated prose, so the client splits on it safely. MUST
// byte-match the constant in src/hooks/use-translator.ts.
const META_SENTINEL = "\n␞__TARJUMAN_META__␞\n";

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
- OFF-LANGUAGE AUDIO: the STT engine is FORCED to the source language, so speech in any other language arrives as a phonetic transliteration into the source script — it looks like source-language words but reads as incoherent nonsense (e.g. English "okay so basically" arriving as "اوكي سو بيسكلي"). If the text is clearly such a transliteration of non-source speech rather than real source-language content, output an empty string. Do NOT attempt a best-effort translation of transliterated noise.
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
- \`combinedTranslatedText\` is the full target-language translation of the verse/hadith with the standard inline citation in PARENTHESES (e.g., \`(Quran Al-Ahzab:56)\` or \`(Sahih al-Bukhari 3367)\` — sunnah.com style for hadith).
- LENGTH CAP: emit a merge when \`combinedTranslatedText\` is under approximately 1200 characters — enough for a full hadith with two narrations (e.g. the Bukhari + Muslim forms of one hadith) or a multi-ayah passage. For a recognized authentic hadith or a well-known verse, prefer merging into ONE message even toward that upper bound rather than leaving it split across several cards. Only let genuinely huge passages (e.g. Ayat al-Kursi in full) stay split.
- If you don't want to merge, simply omit the \`<<<MERGE>>>\` block — output just the plain translation as before.

Example merge output (NEVER actually translate this way unless the current segment really completes a verse):
The full English translation here with citation. (Quran X:Y)
<<<MERGE>>>
{"fromIds":["seg-abc-1"],"combinedSourceText":"<full Arabic>","combinedTranslatedText":"The full English translation here with citation. (Quran X:Y)"}

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

  // Noise filter: drop single-word and off-language-script segments BEFORE
  // hitting the LLM. Saves cost + latency, and the client uses the
  // `filtered: true` flag to suppress the segment from the transcript
  // entirely (neither source card nor translation card renders).
  const noise = shouldFilterAsNoise(text, source);
  if (noise.filter) {
    return NextResponse.json({
      translatedText: "",
      filtered: true,
      filterReason: noise.reason,
    });
  }

  const sourceName = languageName(source);
  const targetName = languageName(target);

  // Hybrid routing: Haiku for normal speech, Sonnet for Quran/hadith content
  // where verse/hadith recognition + citation accuracy matter.
  const model = routeModel(text, context);
  const maxTokens = model === MODEL_SONNET ? 1500 : 500;

  const requestBody = JSON.stringify({
    model,
    max_tokens: maxTokens,
    stream: true,
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
  });

  // Translation is the product, so a transient upstream blip (429 rate limit,
  // 529 overloaded, 5xx, or a brief network error) must not error the segment.
  // Retry once with a short backoff on those retryable failures.
  //
  // 15s timeout per attempt. Haiku usually responds in 0.3–1.5s; Sonnet ~1–3s.
  // Timeouts/aborts are NOT retried — doubling a 15s wait would stall the live
  // transcript, so those fail fast.
  const MAX_ATTEMPTS = 2;
  const RETRY_BACKOFF_MS = 400;
  let response: Response | null = null;
  let lastTransientDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: requestBody,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      // Rate-limited / overloaded / server error → transient; retry if budget left.
      if ((r.status === 429 || r.status >= 500) && attempt < MAX_ATTEMPTS) {
        lastTransientDetail = `HTTP ${r.status}`;
        await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
        continue;
      }
      response = r;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/timed out|abort/i.test(msg)) {
        return NextResponse.json(
          { error: "Translation timed out. Try again." },
          { status: 504 }
        );
      }
      // Network-level throw → transient; retry if budget left, else give up.
      lastTransientDetail = msg;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
        continue;
      }
      return NextResponse.json(
        { error: `Translation failed: ${msg}` },
        { status: 502 }
      );
    }
  }

  if (!response) {
    return NextResponse.json(
      { error: `Translation failed: ${lastTransientDetail || "upstream error"}` },
      { status: 502 }
    );
  }

  // We requested stream:true, so `response.ok` means the SSE stream is open.
  // Non-ok statuses stay JSON-with-real-HTTP-status (429/5xx already handled in
  // the retry loop above; guard the rest here) so the client's status-based
  // retry keeps working. Only the HTTP-200 success path streams.
  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Translation failed: HTTP ${response.status} ${errText.slice(0, 200)}`,
      },
      { status: 502 }
    );
  }

  // Sanity-check merge ids against what the client actually sent so a
  // hallucinated id can't break the client's segment state.
  const validContextIds = new Set<string>(
    (context ?? []).map((c) => c.id).filter((id): id is string => !!id)
  );

  const upstream = response;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = ""; // SSE line buffer
      let rawText = ""; // full accumulated model output (incl. any MERGE block)
      let emitted = 0; // chars of pre-MERGE text already streamed to the client
      let mergeSeen = false;

      const emitMeta = (meta: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(META_SENTINEL + JSON.stringify(meta)));
      };

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
            let evt: {
              type?: string;
              delta?: { type?: string; text?: string };
              error?: { message?: string };
            };
            try {
              evt = JSON.parse(json);
            } catch {
              continue; // ignore malformed SSE line
            }
            // Anthropic emits an `error` event mid-stream on upstream trouble.
            if (evt.type === "error") {
              throw new Error(evt.error?.message ?? "stream-error");
            }
            if (
              evt.type === "content_block_delta" &&
              evt.delta?.type === "text_delta" &&
              typeof evt.delta.text === "string"
            ) {
              rawText += evt.delta.text;
              if (mergeSeen) continue;
              const markerIdx = rawText.indexOf(MERGE_MARKER);
              if (markerIdx === -1) {
                // Hold back the last MERGE_MARKER.length chars so a marker
                // split across two deltas is never partially shown.
                const safeEnd = Math.max(0, rawText.length - MERGE_MARKER.length);
                if (safeEnd > emitted) {
                  controller.enqueue(encoder.encode(rawText.slice(emitted, safeEnd)));
                  emitted = safeEnd;
                }
              } else {
                mergeSeen = true;
                if (markerIdx > emitted) {
                  controller.enqueue(encoder.encode(rawText.slice(emitted, markerIdx)));
                  emitted = markerIdx;
                }
              }
            }
          }
        }

        // Flush any held-back tail of the pre-MERGE text.
        if (!mergeSeen && rawText.length > emitted) {
          controller.enqueue(encoder.encode(rawText.slice(emitted)));
        }

        // Post-process the COMPLETE output exactly as the old non-streaming
        // path did, then deliver it in the metadata trailer.
        const parsed = parseMergeDirective(rawText, validContextIds);
        if (!parsed.translation.trim()) {
          // Empty = the model's "untranslatable noise / off-language" verdict.
          emitMeta({ translatedText: "", filtered: true, filterReason: "model-judged-noise" });
          controller.close();
          return;
        }
        // Citation enrichment: verify hadith (sunnah.com) + Quran (quran.com),
        // swap in canonical bodies + clickable links. Off the perceived path —
        // the plain translation already streamed; this lands in the trailer.
        const hadithEnriched = await verifyAndEnrich(parsed.translation);
        const quranEnriched = await verifyAndEnrichQuran(hadithEnriched.text, target);
        const enrichedMerge = parsed.merge
          ? await (async () => {
              const h = await verifyAndEnrich(parsed.merge!.combinedTranslatedText);
              const q = await verifyAndEnrichQuran(h.text, target);
              return { ...parsed.merge!, combinedTranslatedText: q.text };
            })()
          : undefined;
        emitMeta({
          translatedText: quranEnriched.text,
          ...(enrichedMerge ? { merge: enrichedMerge } : {}),
        });
        controller.close();
      } catch {
        // Upstream read failed mid-stream. The HTTP 200 + partial body is
        // already committed, so we can't change status — signal failure in the
        // trailer and let the client treat it as a retryable error.
        try {
          emitMeta({ error: "stream-interrupted" });
          controller.close();
        } catch {
          /* controller already closed/errored */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
