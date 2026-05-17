/**
 * Sunnah.com API client + citation enrichment.
 *
 * The LLM is the recognizer (Sonnet outputs `(Sahih al-Bukhari 4422)` from
 * memory). This module is the verifier + authoritative-text source:
 *
 *   parseCitations(text)          → extract (Collection Number) patterns
 *   lookupHadith(slug, number)    → GET api.sunnah.com (with cache)
 *   verifyAndEnrich(text)         → orchestrates the above; returns text
 *                                    with verified citations replaced by
 *                                    sunnah.com's canonical body + a
 *                                    markdown link, and 404 citations
 *                                    stripped
 *
 * Behavior is opt-in: without `SUNNAH_API_KEY` in the environment, every
 * call short-circuits with `skipped: true` and the input text comes back
 * unchanged. That lets the rest of the app keep working before the user
 * has a key from sunnah.com.
 */

// Citation pattern matches the (Collection Number) format the prompt
// instructs the LLM to emit. Tolerant of common name variants and the
// "al-" / "at-" prefixes that vary across translations.
const CITATION_RE =
  /\((Sahih\s+(?:al-)?Bukhari|Sahih\s+Muslim|Sunan\s+(?:Abi|Abu)\s+Dawud|Sunan\s+at-?Tirmidhi|Jami['']?\s+at-?Tirmidhi|Sunan\s+an-?Nasa['']?i|Sunan\s+Ibn\s+Majah|Muwatta(?:\s+Malik)?|Musnad\s+Ahmad)\s+(\d+)\)/gi;

// Collection display name → sunnah.com URL / API slug.
const COLLECTION_SLUG: Record<string, string> = {
  bukhari: "bukhari",
  "sahih al-bukhari": "bukhari",
  "sahih bukhari": "bukhari",
  "sahih muslim": "muslim",
  "sunan abi dawud": "abudawud",
  "sunan abu dawud": "abudawud",
  "sunan at-tirmidhi": "tirmidhi",
  "sunan attirmidhi": "tirmidhi",
  "jami' at-tirmidhi": "tirmidhi",
  "jami at-tirmidhi": "tirmidhi",
  "sunan an-nasa'i": "nasai",
  "sunan annasai": "nasai",
  "sunan an-nasai": "nasai",
  "sunan ibn majah": "ibnmajah",
  muwatta: "malik",
  "muwatta malik": "malik",
  "musnad ahmad": "ahmad",
};

function normalizeCollection(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
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

interface SunnahHadithResponse {
  hadith?: { lang: "ar" | "en"; body: string }[];
}

// Cache hadith lookups across requests within the same serverless instance.
// Hadiths don't change — no expiry needed. Negative results ("not-found")
// are cached too so a hallucinated number isn't re-fetched every time.
type CacheEntry =
  | { kind: "found"; englishBody: string; arabicBody: string }
  | { kind: "not-found" }
  | { kind: "unknown" }; // network / rate-limit / config failure — don't cache forever
const lookupCache = new Map<string, CacheEntry>();

const API_BASE = "https://api.sunnah.com/v1";
const LOOKUP_TIMEOUT_MS = 3000;

export async function lookupHadith(
  slug: string,
  number: string
): Promise<CacheEntry> {
  const key = `${slug}:${number}`;
  const cached = lookupCache.get(key);
  // Only persist found / not-found in cache. "unknown" (transient failure)
  // is retried next time.
  if (cached && cached.kind !== "unknown") return cached;

  const apiKey = process.env.SUNNAH_API_KEY;
  if (!apiKey) return { kind: "unknown" };

  try {
    const res = await fetch(
      `${API_BASE}/collections/${slug}/hadiths/${number}`,
      {
        headers: { "X-API-Key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      }
    );
    if (res.status === 404) {
      const entry: CacheEntry = { kind: "not-found" };
      lookupCache.set(key, entry);
      return entry;
    }
    if (!res.ok) {
      // Rate limit, 5xx, etc. — don't strip the citation on a transient
      // failure; just skip verification this time.
      console.warn(
        `[sunnah] lookup ${slug}:${number} returned ${res.status} — keeping citation as-is`
      );
      return { kind: "unknown" };
    }
    const body = (await res.json()) as SunnahHadithResponse;
    const en = body.hadith?.find((h) => h.lang === "en")?.body ?? "";
    const ar = body.hadith?.find((h) => h.lang === "ar")?.body ?? "";
    const entry: CacheEntry = {
      kind: "found",
      englishBody: en,
      arabicBody: ar,
    };
    lookupCache.set(key, entry);
    return entry;
  } catch (e) {
    console.warn(
      `[sunnah] lookup ${slug}:${number} threw: ${
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

/**
 * Pipeline:
 *   - parse citations
 *   - lookup each (cached)
 *   - for each verified citation: replace everything from the start of text
 *     (or the end of the previous citation) up through that citation's
 *     closing paren with `<sunnah canonical body> [(Collection Number)](url)`
 *   - for each 404 citation: strip the parenthetical (keep surrounding text)
 *   - for `unknown` (no key, transient failure): leave the citation alone
 *
 * When `SUNNAH_API_KEY` is missing, returns `{ text, citations: [], skipped: true }`.
 */
export async function verifyAndEnrich(text: string): Promise<{
  text: string;
  citations: VerifiedCitation[];
  skipped: boolean;
}> {
  if (!process.env.SUNNAH_API_KEY) {
    return { text, citations: [], skipped: true };
  }

  const matches = parseCitations(text);
  if (matches.length === 0) {
    return { text, citations: [], skipped: false };
  }

  // Look up all citations in parallel.
  const results = await Promise.all(
    matches.map((m) => lookupHadith(m.slug, m.number))
  );

  // Walk the original text and build the enriched one piece by piece.
  // For each citation:
  //   - "found" → replace lead-in segment (since prev cursor) + citation
  //               with `<canonical body> [(citation)](url)`
  //   - "not-found" → keep lead-in, drop the citation parenthetical
  //   - "unknown" → leave both lead-in and citation as-is
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
      // sunnah.com is the authority — replace the lead-in (LLM's own
      // rendering) with the canonical English body, end with the link.
      const body = result.englishBody.trim();
      out.push(`${body} ${linkMarkdown}`);
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
      // Transient failure — keep everything as the LLM wrote it.
      out.push(`${leadIn}${m.raw}`);
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
