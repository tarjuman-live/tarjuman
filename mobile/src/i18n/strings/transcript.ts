import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "transcript" builder. Prefer the web's MessageKeys
 * (t("record.copy") etc.) — only add strings here that the web doesn't have.
 * Key format: "<owner>.<name>"; English required.
 *
 * These mirror copy the web hardcodes in live-transcript.tsx / split-transcript.tsx
 * (no web MessageKey exists for them). Web keys reused directly:
 * record.listening, record.speakNearby, record.translationHere.
 */
export const TRANSCRIPT_STRINGS = {
  "transcript.translating": { en: "…translating" },
  "transcript.failedRetry": { en: "Translation failed — tap to retry" },
  "transcript.failed": { en: "Translation failed" },
  "transcript.speaker": { en: "Speaker {n}" },
  "transcript.newCount": { en: "{n} new" },
  "transcript.scrollToNew": { en: "Scroll to {n} new segments" },
  "transcript.scrollToNewOne": { en: "Scroll to {n} new segment" },
  "transcript.latest": { en: "latest" },
  "transcript.scrollToLatest": { en: "Scroll to latest" },
  "transcript.speakNearDevice": { en: "Speak or play audio through a speaker near your device." },
} satisfies NativeStrings;
