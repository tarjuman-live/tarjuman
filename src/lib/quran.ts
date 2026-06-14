/**
 * Quran.com API client + citation enrichment.
 *
 * Parallel structure to `src/lib/sunnah.ts`:
 *
 *   parseQuranCitations(text)            → extract (Quran SurahName:Ayah)
 *                                          OR (Quran Number:Ayah) patterns
 *   lookupVerse(surah, ayah)             → GET api.quran.com (with cache)
 *   verifyAndEnrichQuran(text, target)   → orchestrates: replaces verified
 *                                          English text with Muhsin Khan
 *                                          canonical + clickable link;
 *                                          strips 404 citations; for
 *                                          non-English targets keeps LLM
 *                                          translation but still verifies +
 *                                          links
 *
 * Quran.com is a free public API — no key required, no graceful-fallback
 * needed for missing key. Translation ID 95 = Muhsin Khan (Salafi-preferred
 * English; matches what our prompt instructs the LLM to render).
 */

// Citation: (Quran SurahName:Ayah)  or  (Quran 2:255)
const CITATION_RE = /\(Quran\s+([A-Za-z'’\-]+|\d{1,3})\s*:\s*(\d{1,3})\)/g;

const MUHSIN_KHAN_TRANSLATION_ID = 95;
const API_BASE = "https://api.quran.com/api/v4";
const LOOKUP_TIMEOUT_MS = 3000;

// All 114 surahs by quran.com transliteration + common Western variants.
// Lowercased lookup keys.
const SURAH_NUMBER: Record<string, number> = {
  "al-fatihah": 1, "al-fatiha": 1, "fatihah": 1, "fatiha": 1,
  "al-baqarah": 2, "al-baqara": 2, "baqarah": 2, "baqara": 2,
  "al-imran": 3, "ali-imran": 3, "aal-e-imran": 3, "aal-imran": 3,
  "an-nisa": 4, "an-nisaa": 4, "an-nisa'": 4, "nisa": 4, "nisa'": 4,
  "al-maidah": 5, "al-ma'idah": 5, "al-ma-idah": 5, "maidah": 5,
  "al-anam": 6, "al-an'am": 6, "anam": 6,
  "al-araf": 7, "al-a'raf": 7, "araf": 7,
  "al-anfal": 8, "anfal": 8,
  "at-tawbah": 9, "at-tauba": 9, "tawbah": 9, "tauba": 9,
  yunus: 10, "yoonus": 10,
  hud: 11, "hood": 11,
  yusuf: 12, "yusof": 12,
  "ar-rad": 13, "ar-ra'd": 13,
  ibrahim: 14,
  "al-hijr": 15,
  "an-nahl": 16,
  "al-isra": 17, "al-isra'": 17, "bani-israil": 17,
  "al-kahf": 18, kahf: 18,
  maryam: 19,
  "ta-ha": 20, "taha": 20,
  "al-anbiya": 21, "al-anbiya'": 21,
  "al-hajj": 22, hajj: 22,
  "al-muminun": 23, "al-mu'minun": 23,
  "an-nur": 24, "an-noor": 24,
  "al-furqan": 25,
  "ash-shuara": 26, "ash-shu'ara": 26,
  "an-naml": 27,
  "al-qasas": 28,
  "al-ankabut": 29, "al-'ankabut": 29,
  "ar-rum": 30, "ar-room": 30,
  luqman: 31,
  "as-sajdah": 32,
  "al-ahzab": 33, ahzab: 33,
  saba: 34, "saba'": 34,
  fatir: 35,
  "ya-sin": 36, "ya-seen": 36, yasin: 36, yaseen: 36,
  "as-saffat": 37,
  sad: 38, "saad": 38,
  "az-zumar": 39,
  ghafir: 40, "al-mu'min": 40,
  fussilat: 41, "ha-mim-sajdah": 41,
  "ash-shura": 42, "ash-shoora": 42,
  "az-zukhruf": 43,
  "ad-dukhan": 44,
  "al-jathiyah": 45,
  "al-ahqaf": 46,
  muhammad: 47,
  "al-fath": 48,
  "al-hujurat": 49,
  qaf: 50,
  "adh-dhariyat": 51, "az-zariyat": 51,
  "at-tur": 52,
  "an-najm": 53,
  "al-qamar": 54,
  "ar-rahman": 55, "ar-rahmaan": 55,
  "al-waqiah": 56, "al-waqi'ah": 56,
  "al-hadid": 57, "al-hadeed": 57,
  "al-mujadilah": 58, "al-mujadalah": 58,
  "al-hashr": 59,
  "al-mumtahanah": 60, "al-mumtahinah": 60,
  "as-saff": 61,
  "al-jumuah": 62, "al-jumu'ah": 62,
  "al-munafiqun": 63,
  "at-taghabun": 64,
  "at-talaq": 65,
  "at-tahrim": 66,
  "al-mulk": 67,
  "al-qalam": 68,
  "al-haqqah": 69,
  "al-maarij": 70, "al-ma'arij": 70,
  nuh: 71, "nooh": 71,
  "al-jinn": 72,
  "al-muzzammil": 73,
  "al-muddaththir": 74, "al-muddathir": 74,
  "al-qiyamah": 75,
  "al-insan": 76, "ad-dahr": 76,
  "al-mursalat": 77,
  "an-naba": 78, "an-naba'": 78,
  "an-naziat": 79, "an-nazi'at": 79,
  abasa: 80, "'abasa": 80,
  "at-takwir": 81, "at-takweer": 81,
  "al-infitar": 82,
  "al-mutaffifin": 83,
  "al-inshiqaq": 84,
  "al-buruj": 85,
  "at-tariq": 86,
  "al-ala": 87, "al-a'la": 87,
  "al-ghashiyah": 88,
  "al-fajr": 89,
  "al-balad": 90,
  "ash-shams": 91,
  "al-layl": 92, "al-lail": 92,
  "ad-duha": 93, "ad-dhuha": 93,
  "ash-sharh": 94, "al-inshirah": 94,
  "at-tin": 95, "at-teen": 95,
  "al-alaq": 96, "al-'alaq": 96,
  "al-qadr": 97,
  "al-bayyinah": 98,
  "az-zalzalah": 99,
  "al-adiyat": 100, "al-'adiyat": 100,
  "al-qariah": 101, "al-qari'ah": 101,
  "at-takathur": 102,
  "al-asr": 103, "al-'asr": 103,
  "al-humazah": 104,
  "al-fil": 105, "al-feel": 105,
  quraysh: 106, "quraish": 106,
  "al-maun": 107, "al-ma'un": 107,
  "al-kawthar": 108, "al-kauthar": 108,
  "al-kafirun": 109, "al-kaafiroon": 109,
  "an-nasr": 110,
  "al-masad": 111, "al-lahab": 111,
  "al-ikhlas": 112,
  "al-falaq": 113,
  "an-nas": 114, "an-naas": 114,
};

function surahNumberFor(nameOrNumber: string): number | undefined {
  if (/^\d+$/.test(nameOrNumber)) {
    const n = parseInt(nameOrNumber, 10);
    return n >= 1 && n <= 114 ? n : undefined;
  }
  const key = nameOrNumber
    .toLowerCase()
    .replace(/’/g, "'")
    .trim();
  return SURAH_NUMBER[key];
}

export interface VerifiedQuranCitation {
  raw: string;
  surahDisplay: string;
  surahNumber: number;
  ayahNumber: number;
  url: string;
  englishBody?: string;
  arabicBody?: string;
  verified: boolean;
}

type CacheEntry =
  | { kind: "found"; englishBody: string; arabicBody: string }
  | { kind: "not-found" }
  | { kind: "unknown" };
const lookupCache = new Map<string, CacheEntry>();

interface QuranApiResponse {
  verse?: {
    text_uthmani?: string;
    text_indopak?: string;
    text_imlaei?: string;
    translations?: { text: string; resource_id: number }[];
  };
}

function stripHtml(s: string): string {
  // Quran.com translations sometimes include <sup>...</sup> footnote
  // markers. Strip them so the canonical body reads cleanly.
  return s.replace(/<[^>]+>/g, "").trim();
}

export async function lookupVerse(
  surahNumber: number,
  ayahNumber: number
): Promise<CacheEntry> {
  const key = `${surahNumber}:${ayahNumber}`;
  const cached = lookupCache.get(key);
  if (cached && cached.kind !== "unknown") return cached;

  try {
    const url = `${API_BASE}/verses/by_key/${surahNumber}:${ayahNumber}?translations=${MUHSIN_KHAN_TRANSLATION_ID}&fields=text_uthmani`;
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (res.status === 404) {
      const entry: CacheEntry = { kind: "not-found" };
      lookupCache.set(key, entry);
      return entry;
    }
    if (!res.ok) {
      console.warn(
        `[quran] lookup ${key} returned ${res.status} — keeping citation as-is`
      );
      return { kind: "unknown" };
    }
    const body = (await res.json()) as QuranApiResponse;
    const verse = body.verse;
    const en = stripHtml(
      verse?.translations?.find(
        (t) => t.resource_id === MUHSIN_KHAN_TRANSLATION_ID
      )?.text ??
        verse?.translations?.[0]?.text ??
        ""
    );
    const ar = (
      verse?.text_uthmani ??
      verse?.text_imlaei ??
      verse?.text_indopak ??
      ""
    ).trim();
    if (!en && !ar) {
      // Some unexpected payload shape — treat as transient.
      return { kind: "unknown" };
    }
    const entry: CacheEntry = {
      kind: "found",
      englishBody: en,
      arabicBody: ar,
    };
    lookupCache.set(key, entry);
    return entry;
  } catch (e) {
    console.warn(
      `[quran] lookup ${surahNumber}:${ayahNumber} threw: ${
        e instanceof Error ? e.message : String(e)
      } — keeping citation as-is`
    );
    return { kind: "unknown" };
  }
}

export function parseQuranCitations(text: string): Array<{
  raw: string;
  surahDisplay: string;
  surahNumber: number;
  ayahNumber: number;
  index: number;
  endIndex: number;
}> {
  const out: Array<{
    raw: string;
    surahDisplay: string;
    surahNumber: number;
    ayahNumber: number;
    index: number;
    endIndex: number;
  }> = [];
  CITATION_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = CITATION_RE.exec(text)); ) {
    const rawName = m[1];
    const surahNumber = surahNumberFor(rawName);
    if (!surahNumber) continue;
    const ayahNumber = parseInt(m[2], 10);
    if (!Number.isFinite(ayahNumber) || ayahNumber < 1) continue;
    out.push({
      raw: m[0],
      surahDisplay: /^\d+$/.test(rawName) ? `Surah ${surahNumber}` : rawName,
      surahNumber,
      ayahNumber,
      index: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * Apply quran.com verification + enrichment:
 *
 *   - If target language is English AND verified: replace lead-in with
 *     Muhsin Khan canonical + clickable markdown link.
 *   - If verified but target is not English: keep LLM lead-in, just replace
 *     the citation parenthetical with a clickable markdown link.
 *   - If 404 (hallucinated verse number): strip the citation parenthetical.
 *   - On transient API failure: mark the citation `— unverified` rather than
 *     leaving it to read as an authentic verse reference.
 *
 * Quran.com is a free public API; no env-var-missing path needed.
 */
export async function verifyAndEnrichQuran(
  text: string,
  targetLang: string
): Promise<{ text: string; citations: VerifiedQuranCitation[] }> {
  const matches = parseQuranCitations(text);
  if (matches.length === 0) {
    return { text, citations: [] };
  }

  const results = await Promise.all(
    matches.map((m) => lookupVerse(m.surahNumber, m.ayahNumber))
  );

  const targetIsEnglish = (targetLang || "").toLowerCase().startsWith("en");
  const out: string[] = [];
  const citations: VerifiedQuranCitation[] = [];
  let cursor = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const result = results[i];
    const url = `https://quran.com/${m.surahNumber}/${m.ayahNumber}`;
    const linkLabel = `(Quran ${m.surahDisplay}:${m.ayahNumber})`;
    const linkMarkdown = `[${linkLabel}](${url})`;
    const leadIn = text.slice(cursor, m.index);

    if (result.kind === "found") {
      const body = result.englishBody.trim();
      if (targetIsEnglish && body) {
        // Replace lead-in (LLM's English) with canonical Muhsin Khan body.
        out.push(`${body} ${linkMarkdown}`);
      } else {
        // Non-English target, OR no canonical English body available — keep
        // the LLM's own rendering and just upgrade the citation to a verified
        // link. The verse is confirmed to exist; only its canonical English
        // text is missing, so we never emit a bare empty-bodied link.
        out.push(`${leadIn}${linkMarkdown}`);
      }
      citations.push({
        raw: m.raw,
        surahDisplay: m.surahDisplay,
        surahNumber: m.surahNumber,
        ayahNumber: m.ayahNumber,
        url,
        englishBody: result.englishBody,
        arabicBody: result.arabicBody,
        verified: true,
      });
    } else if (result.kind === "not-found") {
      // Hallucinated verse — drop citation, keep surrounding text.
      out.push(leadIn.replace(/\s+$/, ""));
      citations.push({
        raw: m.raw,
        surahDisplay: m.surahDisplay,
        surahNumber: m.surahNumber,
        ayahNumber: m.ayahNumber,
        url,
        verified: false,
      });
    } else {
      // Could not verify (transient quran.com failure). Mark it unverified
      // rather than presenting it as an authentic verse reference. The
      // " — unverified" before the ")" also stops the citation regex from
      // re-matching, so a second pass can't double-mark it.
      out.push(
        `${leadIn}(Quran ${m.surahDisplay}:${m.ayahNumber} — unverified)`
      );
      citations.push({
        raw: m.raw,
        surahDisplay: m.surahDisplay,
        surahNumber: m.surahNumber,
        ayahNumber: m.ayahNumber,
        url,
        verified: false,
      });
    }
    cursor = m.endIndex;
  }
  out.push(text.slice(cursor));

  return { text: out.join("").trim(), citations };
}
