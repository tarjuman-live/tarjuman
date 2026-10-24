/**
 * Translation prompt + model-routing primitives.
 *
 * Extracted from src/app/api/translate/route.ts so the production route and the
 * bench harness (bench/translate-model-compare.ts) share ONE definition. A
 * benchmark that rebuilds the prompt independently silently drifts from
 * production the moment either copy changes, and then measures something the
 * app never sends.
 *
 * Everything here is pure — no Next.js, no network, no env — which is what
 * makes it importable from a plain tsx script.
 */

import {
  ISLAMIC_TERMINOLOGY_RULES,
  ISLAMIC_FEW_SHOT_EXAMPLES,
} from "@/lib/islamic-terminology";
import { isOffLanguageScript } from "@/lib/script";

/** A prior segment sent purely for disambiguation. */
export interface TranslateContextEntry {
  id: string;
  sourceText: string;
  translatedText?: string;
}

export interface MergeDirective {
  /** IDs from `context` that this segment should absorb. */
  fromIds: string[];
  /** Full source (Arabic verse, hadith text) — children + this concatenated. */
  combinedSourceText: string;
  /** Full translation with the citation. */
  combinedTranslatedText: string;
}

// ─── Model routing ─────────────────────────────────────────────────────────
// EVERY segment translates on Haiku 4.5. There is no escalation path.
//
// This used to route Quran/hadith-looking segments to Sonnet on the theory that
// verse recognition and citation accuracy justified the latency. Measured, the
// tradeoff turned out to run the other way. bench/translate-model-compare.ts,
// 10 cases pooled over two 3-run passes against the live API (n=60/model,
// 2026-08):
//
//     metric                        haiku-4.5     sonnet-5
//     fully correct                   41/60        44/60
//     merge misses                      17           12
//     FABRICATED citations               0            6
//     MISATTRIBUTED citations            0            4
//     median latency                ~1150ms      ~4250ms
//
// Read that honestly: Sonnet wins the composite score by ~5pp. The decision to
// drop it anyway rests on the two columns not being commensurable.
//
// Sonnet's entire edge is MERGE behavior, and a merge miss is cosmetic — the
// verse is still translated correctly and still cited correctly, it just stays
// split across two transcript cards instead of collapsing into one.
//
// Sonnet's deficit is citation integrity, and that is not cosmetic. What the
// downstream verifier (src/lib/{sunnah,quran}.ts) can do about it:
//
//   ✓ a citation whose number does not exist  → stripped   (all 6 fabrications)
//   ✓ a correct citation                      → canonical text + link
//   ✗ MISATTRIBUTION is invisible to it: (Quran Al-Baqarah:155) emitted for
//     verse 156 resolves `found`, so the canonical body of 155 gets appended
//     and the WRONG verse is published with full authority.
//
// So the trade is: give up ~5pp of a score dominated by card-splitting, to take
// misattribution from 4 to 0. For an audience receiving Quran and hadith, a
// confidently-wrong citation is the worst output this app can produce, and it
// is the one error class nothing downstream can catch. Verifier-first is not
// "the cheap model plus a safety net" — on the metric with NO safety net, Haiku
// was simply the safer model, and it is ~3s/segment faster on a live transcript.
//
// If merge quality ever needs to improve, the move is a better merge prompt or
// a targeted second pass on citation segments — not a blanket escalation that
// reintroduces misattribution everywhere to fix card-splitting.
//
// Two further findings from the same run, both arguing against the old router:
//
//  1. THE LATCH. routeModel scanned the rolling 6-segment context (and prior
//     translations' citations) as well as the current text. A khutbah quotes
//     continuously, so one citation latched the session onto Sonnet for the
//     rest of it. The bench's three `latched` cases — ordinary prose escalated
//     only because something earlier carried a citation — scored 9/9 on BOTH
//     models, in both passes. The latch bought nothing measurable and cost
//     1.2–1.7s per segment.
//
//  2. IT FIRED ON THE WRONG SEGMENTS. The marker set matched prose like
//     "في سورة البقرة" (a passing reference) while MISSING real verse openers
//     like "قال الله في القرآن الكريم" — so the two split-verse cases, the ones
//     that most needed recognition, routed to Haiku anyway. Escalation was
//     close to anti-correlated with need.
//
// The marker regexes and the context-scanning predicate were deleted rather
// than left unused; `git log -- src/lib/translate-prompt.ts` has them if a
// future measurement ever justifies bringing escalation back. Re-introducing
// one means re-running the bench, not restoring the old heuristic.

export const MODEL_HAIKU = "claude-haiku-4-5-20251001";
// Latest Sonnet (verified live via GET /v1/models on 2026-07-01; supersedes
// Sonnet 4.6). No longer on the translate path — retained because
// bench/translate-model-compare.ts still measures against it, so the day
// someone proposes re-escalating, the comparison is one command away.
export const MODEL_SONNET = "claude-sonnet-5";

/**
 * Always Haiku — see the measurement above.
 *
 * Kept as a function (rather than inlining the constant at the call site) so
 * routing stays one seam: if escalation is ever re-justified by a bench run,
 * this is the only place that changes. The parameters are intentionally unused
 * today and kept for exactly that reason — they hold every caller to passing
 * the segment and its context, so restoring escalation touches only this body.
 */
export function routeModel(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _text: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: TranslateContextEntry[] | undefined,
): string {
  return MODEL_HAIKU;
}

// ─── Noise filter ──────────────────────────────────────────────────────────
// Drop segments before they ever hit the LLM:
//   1. A single word — isolated interjections like "اجمعين" are noise (2-word
//      dhikr is kept; see below).
//   2. Off-language by script — non-source-script text in an RTL session (e.g.
//      English in an Arabic session). Server-side backstop to the client gate
//      in the Speechmatics core and use-deepgram; both share src/lib/script.ts.
//   3. One token repeated ≥3× — the engine hallucinating on non-speech.

export function shouldFilterAsNoise(
  text: string,
  sourceLang: string | undefined,
): { filter: boolean; reason?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { filter: true, reason: "empty" };

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  // Allow 2-word segments: the most common dhikr is exactly two words —
  // "الله أكبر", "سبحان الله", "الحمد لله" — and dropping them mangles the
  // primary use case. Only a single isolated word is treated as noise.
  if (wordCount < 2) {
    return { filter: true, reason: `too-short (${wordCount} word(s))` };
  }

  if (isOffLanguageScript(trimmed, sourceLang)) {
    return { filter: true, reason: "off-language-script" };
  }

  if (isRepeatedTokenNoise(trimmed)) {
    return { filter: true, reason: "repeated-token" };
  }

  return { filter: false };
}

// Repeated-token hallucination. On sustained NON-speech (AC hum, distant
// nasheed/music, crowd murmur, coughs) a realtime engine's well-known failure
// mode is to emit a single token repeated — "الله الله الله", "نعم نعم نعم".
// That passes the word-count and off-language-script gates and would render as
// plausible dhikr the speaker never said (the reported "picks up words that
// weren't spoken"). Drop it ONLY when EVERY word is the same token repeated
// ≥3×. High-precision: genuine repeated dhikr always has ≥2 distinct tokens
// ("الله أكبر الله أكبر", "سبحان الله سبحان الله"), so it's never touched.
// Punctuation and case are normalized out before the uniqueness test.
export function isRepeatedTokenNoise(text: string): boolean {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase())
    .filter(Boolean);
  if (words.length < 3) return false;
  return new Set(words).size === 1;
}

export function buildUserMessage(opts: {
  text: string;
  sourceName: string;
  targetName: string;
  context?: TranslateContextEntry[];
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
export const MERGE_MARKER = "<<<MERGE>>>";

// Separates the streamed plain-translation text from the final metadata JSON
// trailer (enriched text + merge/filtered/error). The U+241E control char can
// never appear in translated prose, so the client splits on it safely. MUST
// byte-match the constant in src/hooks/use-translator.ts.

export const META_SENTINEL = "\n␞__TARJUMAN_META__␞\n";

export function parseMergeDirective(
  raw: string,
  validContextIds: Set<string>,
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
          (x): x is string => typeof x === "string",
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
// large enough to exceed the cache minimum on both models (Haiku 4.5 needs
// 4096 tokens, Sonnet 5 needs 1024; measured at 5945/7918), so subsequent
// calls within a 5-minute window pay ~10% of input cost. Shortening this
// prompt below 4096 Haiku tokens would silently stop caching — no error.
export const SYSTEM_PROMPT = `You are a translation engine for a live transcription app used by Sunni Muslim audiences for Islamic sermons (khutbahs), lectures, classes, Quranic study, and religious talks. Interpret all Islamic content within the framework of Ahl as-Sunnah wal-Jama'ah following the methodology of the Salaf as-Salih (the righteous predecessors). Translate the user's text from the source language to the target language and output ONLY the translation — no preamble, no commentary, no quotation marks, no language labels.

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
