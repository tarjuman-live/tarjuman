import { describe, expect, it } from "vitest";
import { looksLikeMetaCommentary } from "./translation-guard";

describe("looksLikeMetaCommentary", () => {
  // Every one of these must be blanked: they are the model talking ABOUT the
  // input instead of translating it, and must never reach the transcript.
  const leaks = [
    '""',
    "''",
    "…",
    "(empty)",
    "[empty]",
    "(No output - noise)",
    "(no translation)",
    "(Empty string — the input is a transliteration artifact)",
    "(empty response)",
    "I am outputting an empty string as instructed.",
    "This was transliterated phonetically into Arabic script.",
    "Please provide actual Arabic or English speech content, and I'll translate it.",
    "There is no meaningful text to translate.",
    "I'm not recognizing this as coherent Arabic.",
    "This is phonetic English written in Arabic letters.",
    "I recognize this as a transliteration artifact.",
  ];
  for (const leak of leaks) {
    it(`blanks: ${leak}`, () => {
      expect(looksLikeMetaCommentary(leak)).toBe(true);
    });
  }

  // Real khutbah/lecture translations — including religious phrasing that
  // overlaps the markers' vocabulary — must pass untouched.
  const genuine = [
    "All praise is due to Allah, Lord of the worlds.",
    "Indeed, the Quran is untranslatable in its full beauty.",
    "Do not let your heart become an empty vessel.",
    "He held the empty string of prayer beads.",
    "This does not constitute disbelief, as the scholars said.",
    "Say: He is Allah, the One.",
    '"Actions are judged by intentions." (Sahih al-Bukhari 1)',
    "No.",
  ];
  for (const text of genuine) {
    it(`keeps: ${text}`, () => {
      expect(looksLikeMetaCommentary(text)).toBe(false);
    });
  }
});
