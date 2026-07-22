/**
 * Hadith citation verification + enrichment.
 *
 * The LLM is the recognizer (it outputs `(Sahih al-Bukhari 4422)` from memory).
 * This module is the verifier + authoritative-text source:
 *
 *   parseCitations(text)          → extract (Collection Number) patterns
 *   lookupHadith(slug, number)    → GET the open hadith dataset CDN (cached)
 *   verifyAndEnrich(text)         → orchestrates the above; returns text
 *                                    with verified citations replaced by the
 *                                    canonical body + a sunnah.com markdown
 *                                    link, and 404 citations stripped
 *
 * SOURCE: the fawazahmed0 hadith-api dataset (Unlicense / public domain), served
 * from GitHub raw — NOT sunnah.com's gated production API. It uses sunnah.com's
 * exact continuous numbering and the Muhsin Khan English (verified aligned), so
 * no API key is required. The user-facing link still points at sunnah.com.
 *
 * Fail-safe: a hadith citation is only ever presented as authentic once it's
 * been verified against the dataset. When verification is unavailable — a
 * transient lookup failure, or a collection not in the dataset (e.g. Musnad
 * Ahmad) — the citation is marked `— unverified` instead of passing through as
 * if confirmed. (Hallucinated numbers that 404 are stripped.) So the app never
 * puts an unconfirmed hadith reference on screen with false authority.
 */

// Citation pattern matches the (Collection Number) format the prompt
// instructs the LLM to emit. Tolerant of common name variants and the
// "al-" / "at-" prefixes that vary across translations.
const CITATION_RE =
  /\((Sahih\s+(?:al-)?Bukhari|Sahih\s+Muslim|Sunan\s+(?:Abi|Abu)\s+Dawud|Sunan\s+at-?Tirmidhi|Jami['']?\s+at-?Tirmidhi|Sunan\s+an-?Nasa['']?i|Sunan\s+Ibn\s+Majah|Muwatta(?:\s+Malik)?|Musnad\s+Ahmad)\s+(\d+)\)/gi;

// Collection display name → sunnah.com URL / API slug.
// Keys are in NORMALIZED form (lowercase, apostrophes + hyphens removed) so
// every rendering variant the LLM emits resolves to one entry. See
// normalizeCollection below.
const COLLECTION_SLUG: Record<string, string> = {
  bukhari: "bukhari",
  "sahih albukhari": "bukhari",
  "sahih bukhari": "bukhari",
  "sahih muslim": "muslim",
  "sunan abi dawud": "abudawud",
  "sunan abu dawud": "abudawud",
  "sunan attirmidhi": "tirmidhi",
  "jami attirmidhi": "tirmidhi",
  "sunan annasai": "nasai",
  "sunan ibn majah": "ibnmajah",
  muwatta: "malik",
  "muwatta malik": "malik",
  "musnad ahmad": "ahmad",
};

// Normalize away the apostrophe / hyphen variation the LLM emits — e.g.
// "Jami' at-Tirmidhi", "Jami atTirmidhi", "Sunan an-Nasa'i" all collapse to a
// single key. Without this, a recognized-but-unresolved citation would be
// skipped by parseCitations and slip past the fail-safe reading as authentic.
function normalizeCollection(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugFor(name: string): string | undefined {
  return COLLECTION_SLUG[normalizeCollection(name)];
}

export interface VerifiedCitation {
  /** Original parenthetical as it appeared in the LLM output. */
  raw: string;
  /** Display name (e.g., "Sahih al-Bukhari"). */
  collectionDisplay: string;
  /** sunnah.com URL slug (e.g., "bukhari"). */
  slug: string;
  /** Hadith number within the collection. */
  number: string;
  /** Public sunnah.com page URL the user can open. */
  url: string;
  /** Canonical English body — present only when verified. */
  englishBody?: string;
  /** Canonical Arabic body — present only when verified. */
  arabicBody?: string;
  verified: boolean;
}

// Per-hadith shape from the fawazahmed0 hadith-api CDN dataset.
interface FawazHadithResponse {
  hadiths?: { hadithnumber: number; text: string }[];
}

// Cache hadith lookups across requests within the same serverless instance.
// Hadiths don't change — no expiry needed. Negative results ("not-found")
// are cached too so a hallucinated number isn't re-fetched every time.
type CacheEntry =
  | { kind: "found"; englishBody: string; arabicBody: string }
  | { kind: "not-found" }
  | { kind: "unknown" }; // network / rate-limit / config failure — don't cache forever
const lookupCache = new Map<string, CacheEntry>();

// GitHub raw (NOT jsDelivr): the full hadith-api package exceeds jsDelivr's
// 150MB serving limit, so jsDelivr 403s many files. GitHub raw serves the
// per-hadith files reliably. Volume is low (a few per summary, cached in-memory)
// and any transient raw failure degrades safely to "— unverified" (never wrong).
// If this ever needs to scale, mirror the editions into a Convex `hadiths` table.
const CDN_BASE =
  "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions";
const LOOKUP_TIMEOUT_MS = 3000;

// Collections present in the dataset (eng-<slug> + ara-<slug>). Musnad Ahmad
// ("ahmad") is NOT in it — those citations resolve to "unknown" (marked
// "— unverified") rather than being stripped as if hallucinated.
const SUPPORTED_EDITIONS = new Set([
  "bukhari",
  "muslim",
  "abudawud",
  "tirmidhi",
  "nasai",
  "ibnmajah",
  "malik",
]);

// Fetch one hadith's text. Returns the (trimmed) text, "" when the file 200s
// but has no usable text, or null on a 404 (genuinely no such number).
async function fetchBody(
  edition: string,
  number: string
): Promise<string | null> {
  const res = await fetch(`${CDN_BASE}/${edition}/${number}.json`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as FawazHadithResponse;
  return body.hadiths?.[0]?.text?.trim() ?? "";
}

export async function lookupHadith(
  slug: string,
  number: string
): Promise<CacheEntry> {
  const key = `${slug}:${number}`;
  const cached = lookupCache.get(key);
  // Only persist found / not-found in cache. "unknown" (transient failure)
  // is retried next time.
  if (cached && cached.kind !== "unknown") return cached;

  // Collection we can't verify (e.g. Musnad Ahmad) → "unknown" so it's marked
  // unverified, NOT stripped as hallucinated.
  if (!SUPPORTED_EDITIONS.has(slug)) return { kind: "unknown" };

  try {
    // Start the (optional, best-effort) Arabic fetch CONCURRENTLY with the
    // English one instead of serially after it — the Arabic edition being slow
    // otherwise doubled worst-case latency on the translate hot path (~3s → ~6s
    // per hadith). English stays the sole rejection path; Arabic errors are
    // swallowed and never block the verified English.
    const arP = fetchBody(`ara-${slug}`, number).catch(() => "");
    const en = await fetchBody(`eng-${slug}`, number);
    if (en === null) {
      // 404 — the cited number doesn't exist (hallucinated). Strip it.
      const entry: CacheEntry = { kind: "not-found" };
      lookupCache.set(key, entry);
      return entry;
    }
    // A 200 with no usable English body must NOT count as "found": the enrich
    // step displays the English body, so an empty one would emit a bare link
    // AND delete the speaker's own rendering. Treat it as unverifiable.
    if (!en) return { kind: "unknown" };

    // Arabic is best-effort — its absence shouldn't block the verified English.
    const ar = (await arP) ?? "";

    const entry: CacheEntry = { kind: "found", englishBody: en, arabicBody: ar };
    lookupCache.set(key, entry);
    return entry;
  } catch (e) {
    console.warn(
      `[sunnah] lookup ${slug}:${number} failed: ${
        e instanceof Error ? e.message : String(e)
      } — keeping citation as-is`
    );
    return { kind: "unknown" };
  }
}

/**
 * Find every citation parenthetical in `text` and resolve its slug.
 * Returns one entry per parenthetical with a recognizable collection;
 * unknown / malformed prefixes are skipped silently.
 */
export function parseCitations(text: string): Array<{
  raw: string;
  collectionDisplay: string;
  slug: string;
  number: string;
  index: number;
  endIndex: number;
}> {
  const out: Array<{
    raw: string;
    collectionDisplay: string;
    slug: string;
    number: string;
    index: number;
    endIndex: number;
  }> = [];
  // Reset lastIndex defensively since we're using /g.
  CITATION_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = CITATION_RE.exec(text)); ) {
    const collectionDisplay = m[1].replace(/\s+/g, " ").trim();
    const slug = slugFor(collectionDisplay);
    if (!slug) continue;
    const number = m[2];
    out.push({
      raw: m[0],
      collectionDisplay,
      slug,
      number,
      index: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return out;
}

// Marker for a recognized-but-unverified hadith citation. We couldn't confirm
// it against sunnah.com (no key, or transient failure), so it must not read as
// authentic. The trailing " — unverified" before the ")" also means the
// citation regex won't re-match it, so a second pass can't double-mark.
function unverifiedCitation(collectionDisplay: string, number: string): string {
  return `(${collectionDisplay} ${number} — unverified)`;
}

/**
 * Pipeline:
 *   - parse citations
 *   - lookup each (cached) against the open hadith dataset
 *   - "found"     → replace the lead-in (LLM's own rendering) + citation with
 *                   `<sunnah canonical body> [(Collection Number)](url)`
 *   - "not-found" → strip the parenthetical (hallucinated number)
 *   - "unknown"   → could NOT verify (no key, or transient failure). Mark the
 *                   citation `— unverified` so it is never presented as an
 *                   authentic hadith reference. Fail-safe for the audience.
 *
 * `skipped` is true only when there were no citations to process.
 */
export async function verifyAndEnrich(text: string): Promise<{
  text: string;
  citations: VerifiedCitation[];
  skipped: boolean;
}> {
  const all = parseCitations(text);
  if (all.length === 0) {
    return { text, citations: [], skipped: true };
  }
  // Bound outbound lookups: a real summary cites a handful of hadith. A
  // pathological input could list thousands; cap to the first 50 so a single
  // request can't fan out an unbounded burst of CDN fetches. Citations beyond
  // the cap stay in the text verbatim (only reachable via deliberate abuse).
  const matches = all.length > 50 ? all.slice(0, 50) : all;

  // Verify each citation against the open hadith dataset (no key needed). Any
  // that can't be confirmed (transient failure, or an unsupported collection
  // like Musnad Ahmad) resolve to "unknown" and are marked "— unverified"
  // below — never presented as authentic.
  const results: CacheEntry[] = await Promise.all(
    matches.map((m) => lookupHadith(m.slug, m.number))
  );

  // Walk the original text and build the enriched one piece by piece.
  const out: string[] = [];
  const citations: VerifiedCitation[] = [];
  let cursor = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const result = results[i];
    const url = `https://sunnah.com/${m.slug}:${m.number}`;
    const linkMarkdown = `[(${m.collectionDisplay} ${m.number})](${url})`;
    const leadIn = text.slice(cursor, m.index);

    if (result.kind === "found") {
      // sunnah.com is the authority for the hadith TEXT. But `leadIn` is the
      // summary's own prose since the PREVIOUS citation — not merely this
      // hadith's rendering — so it must be preserved. Keep the lead-in, then
      // append the canonical English body + link.
      //
      // (Previously the lead-in was dropped here, which silently DELETED every
      // sentence of the summary preceding a verified hadith and replaced it
      // with the raw hadith body — corrupting and persisting the summary on the
      // happy path. Never delete the speaker's/summary's own words.)
      const body = result.englishBody.trim();
      const lead = leadIn.replace(/\s+$/, "");
      out.push(lead ? `${lead} ${body} ${linkMarkdown}` : `${body} ${linkMarkdown}`);
      citations.push({
        raw: m.raw,
        collectionDisplay: m.collectionDisplay,
        slug: m.slug,
        number: m.number,
        url,
        englishBody: result.englishBody,
        arabicBody: result.arabicBody,
        verified: true,
      });
    } else if (result.kind === "not-found") {
      // Hallucinated number — drop the parenthetical, keep surrounding text.
      // Trim trailing whitespace from lead-in so we don't leave a dangling
      // space where the citation used to be.
      out.push(leadIn.replace(/\s+$/, ""));
      citations.push({
        raw: m.raw,
        collectionDisplay: m.collectionDisplay,
        slug: m.slug,
        number: m.number,
        url,
        verified: false,
      });
    } else {
      // Could not verify (no key / transient failure). Mark it unverified
      // rather than presenting it as an authentic hadith reference.
      out.push(`${leadIn}${unverifiedCitation(m.collectionDisplay, m.number)}`);
      citations.push({
        raw: m.raw,
        collectionDisplay: m.collectionDisplay,
        slug: m.slug,
        number: m.number,
        url,
        verified: false,
      });
    }
    cursor = m.endIndex;
  }
  // Tail after the last citation.
  out.push(text.slice(cursor));

  return {
    text: out.join("").trim(),
    citations,
    skipped: false,
  };
}
