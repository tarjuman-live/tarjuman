/**
 * Defensive guard against the translation model leaking meta-commentary into
 * the transcript.
 *
 * The /api/translate system prompt explicitly tells the model to output ONLY
 * the translation and, for untranslatable noise, to output an empty string
 * "without explaining why." It usually obeys — but on garbled/transliterated
 * STT output it occasionally disobeys and returns a first-person explanation
 * instead, e.g.:
 *
 *   "I recognize this as a transliteration artifact — the STT engine has
 *    mangled … does not constitute meaningful source text. (empty string)"
 *
 * That text must NEVER surface as a translation. Prompt instructions alone
 * can't guarantee it (the model already ignored them here), so this is the
 * hard backstop: run it on the model output; if it looks like commentary,
 * the caller treats it exactly like the empty/untranslatable verdict — blank
 * translation, keep the source (fail-open, never delete valid source speech).
 *
 * Used on BOTH sides of the stream: server-side on the final text (so it never
 * persists) and client-side on the interim preview (so it never even flashes).
 *
 * Markers are deliberately high-precision — phrases a real khutbah/lecture
 * translation would essentially never contain — to avoid false-positively
 * blanking a legitimate translation. When in doubt, a marker is left OUT.
 */
// Every marker below is phrasing a real khutbah/lecture translation would
// essentially never contain, so blanking on a match is safe. Deliberately
// EXCLUDED (too broad — appear in genuine religious content): "untranslatable"
// ("the Quran is untranslatable"), "does not constitute" (fiqh: "does not
// constitute disbelief"), "no meaningful content", bare "gibberish"/"I
// apologize". Detection still fires — the model's leak carries several of the
// unambiguous tells below at once.
const COMMENTARY_MARKERS: RegExp[] = [
  // Self-reference / model voice
  /\bas an AI\b/i,
  /\b(?:large )?language model\b/i,
  /\btranslation model\b/i,
  /\bI recognize this as\b/i,
  /\bI (?:cannot|can'?t|am unable to|'?m unable to) (?:translate|render)\b/i,
  /\bcannot be (?:meaningfully )?translated\b/i,
  // Describing/diagnosing the input instead of translating it
  /\btransliteration artifact\b/i,
  /\bphonetically[-\s]?transliterat/i,
  /\bspeech[-\s]?to[-\s]?text\b/i,
  /\bSTT\b/,
  /\bnon-?words?\b/i,
  /\bmeaningful source text\b/i,
  /\bappears to be (?:spoken |mangled |garbled |a )?(?:transliteration|gibberish|noise|non-)/i,
  // The model narrating its "empty" verdict as text — the canonical failure this
  // guard exists for. It wraps the verdict in a parenthetical opener — observed
  // as "(Empty string — …)" and "(empty response)" — so match the paren-anchored
  // "(empty <string|response|output|translation>" family (anchored so a real
  // "the empty string of prayer beads" can't false-positive). Also catch the
  // unambiguous "empty response/output/translation" phrases without the paren —
  // real khutbah/lecture prose never contains them.
  /\(\s*empty[-\s]?(?:string|response|output|translation|result)\b/i,
  /\bempty (?:response|output|translation)\b/i,
  // "empty string" is the model echoing its own instruction ("output an empty
  // string") back as prose — present in nearly every observed leak ("outputting
  // an empty string", "(Empty string —…"). A translation of religious speech
  // essentially never contains the phrase; blanking fails OPEN (source card is
  // kept), so the asymmetry favors catching it.
  /\bempty string\b/i,
  // "transliterated phonetically into…", "transliteration of English", etc. —
  // the model describing the input's form instead of translating it.
  /\btransliterat(?:ed|ion|ing) (?:phonetically|into|of|from|as)\b/i,
  // The model instructing the user to supply different input, or narrating that
  // it *will* translate — a real translation never addresses the user this way.
  // (Observed: "…Please provide actual Arabic or English speech content, and
  //  I'll translate it according to the rules.")
  /\bplease provide (?:actual|valid|real|proper|coherent|the actual)\b/i,
  /\bI'?ll translate it\b/i,
  // Diagnosing the input as not-real-language: "I'm not recognizing this as
  // coherent Arabic…", "…phonetic English/transliteration…", "…written in /
  // rendered as Arabic letters/characters".
  /\brecognizing this as (?:coherent|meaningful|valid|real)\b/i,
  /\bphonetic (?:transliteration|english|arabic|spanish|french|turkish|urdu|latin)\b/i,
  /\b(?:written in|rendered as) (?:arabic|latin|hebrew|cyrillic|roman) (?:letters|characters|script)\b/i,
];

export function looksLikeMetaCommentary(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 3) return false;
  return COMMENTARY_MARKERS.some((re) => re.test(t));
}
