import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseCitations, verifyAndEnrich } from "./sunnah";
import { parseQuranCitations } from "./quran";

// These tests cover citation recognition + the fail-safe that marks an
// unverifiable citation "— unverified" instead of letting it read as authentic.
// The hadith lookup is stubbed unreachable (no real network); the verified/404
// branches hit the live CDN / quran.com and are left to integration testing.

describe("parseCitations (hadith) — every rendering variant resolves to a slug", () => {
  // The slug map missed apostrophe/hyphen variants before the fail-safe work;
  // a recognized-but-unresolved citation would slip past unmarked. Lock that shut.
  const cases: Array<[string, string]> = [
    ["(Sahih al-Bukhari 1)", "bukhari"],
    ["(Sahih Bukhari 1)", "bukhari"],
    ["(Sahih Muslim 223)", "muslim"],
    ["(Sunan at-Tirmidhi 5)", "tirmidhi"],
    ["(Sunan atTirmidhi 5)", "tirmidhi"],
    ["(Jami at-Tirmidhi 5)", "tirmidhi"],
    ["(Jami' at-Tirmidhi 5)", "tirmidhi"],
    ["(Jami atTirmidhi 5)", "tirmidhi"], // the variant that used to leak
    ["(Sunan an-Nasa'i 10)", "nasai"],
    ["(Sunan anNasai 10)", "nasai"],
    ["(Sunan Ibn Majah 7)", "ibnmajah"],
    ["(Sunan Abi Dawud 3)", "abudawud"],
    ["(Musnad Ahmad 99)", "ahmad"],
  ];
  for (const [raw, slug] of cases) {
    it(`resolves ${raw} → ${slug}`, () => {
      const parsed = parseCitations(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].slug).toBe(slug);
    });
  }

  it("ignores an unrecognized collection", () => {
    expect(parseCitations("(Foo Bar 5)")).toHaveLength(0);
  });
});

describe("verifyAndEnrich fail-safe (lookup unavailable)", () => {
  // Stub the hadith dataset as unreachable (transient failure): every lookup
  // resolves to "unknown", so citations must be marked "— unverified" rather
  // than presented as authentic. No real network in unit tests.
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks an unverifiable hadith citation '— unverified' and keeps the text", async () => {
    const input = "The Prophet ﷺ encouraged kindness (Sahih al-Bukhari 6011).";
    const { text, citations, skipped } = await verifyAndEnrich(input);
    expect(text).toContain("(Sahih al-Bukhari 6011 — unverified)");
    expect(text).toContain("The Prophet ﷺ encouraged kindness"); // speaker's words preserved
    expect(skipped).toBe(false);
    expect(citations[0].verified).toBe(false);
  });

  it("never emits a bare authoritative citation when it cannot verify", async () => {
    const { text } = await verifyAndEnrich("Narrated in (Sahih Muslim 2564).");
    // The only citation present must carry the unverified marker.
    expect(text).toContain("— unverified)");
    expect(text).not.toMatch(/\(Sahih Muslim 2564\)(?! — unverified)/);
  });

  it("reports skipped=true and leaves text unchanged when there are no citations", async () => {
    const input = "A reminder about patience and gratitude.";
    const { text, skipped } = await verifyAndEnrich(input);
    expect(skipped).toBe(true);
    expect(text).toBe(input);
  });

  it("is idempotent — a second pass does not double-mark", async () => {
    const first = await verifyAndEnrich("See (Sahih al-Bukhari 1).");
    const second = await verifyAndEnrich(first.text);
    expect(second.text).toBe(first.text);
    expect(second.skipped).toBe(true); // already-marked text matches no citation regex
  });
});

describe("parseQuranCitations — surah names and numbers resolve", () => {
  it("resolves a named surah", () => {
    const [m] = parseQuranCitations("(Quran Al-Baqarah:255)");
    expect(m.surahNumber).toBe(2);
    expect(m.ayahNumber).toBe(255);
  });

  it("resolves a numeric surah", () => {
    const [m] = parseQuranCitations("(Quran 36:1)");
    expect(m.surahNumber).toBe(36);
  });

  it("ignores a non-existent surah name", () => {
    expect(parseQuranCitations("(Quran NotASurah:1)")).toHaveLength(0);
  });
});
