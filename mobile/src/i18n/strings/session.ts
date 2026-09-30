import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "session" builder (History list, session
 * card menu, session detail, summary). Prefer the web's MessageKeys
 * (t("record.copy"), t("history.title") …) — only strings the web hard-codes
 * in English (no MessageKey) live here. Key format: "session.<name>".
 */
export const SESSION_STRINGS = {
  // History header / list (history/page.tsx hard-codes these)
  "session.countOne": { en: "1 session" },
  "session.countMany": { en: "{n} sessions" },
  "session.countOf": { en: "{visible} of {total}" },
  "session.noMatch": { en: "No sessions match “{q}”." },
  "session.clearSearchA11y": { en: "Clear search" },

  // Session card (session-card.tsx)
  "session.untitled": { en: "Untitled session" },
  "session.summaryBadge": { en: "Summary" },
  "session.options": { en: "Session options" },
  "session.rename": { en: "Rename" },
  "session.delete": { en: "Delete" },
  "session.renameTitle": { en: "Rename session" },
  "session.renameLabel": { en: "Session name" },
  "session.renamePlaceholder": { en: "e.g. Friday khutbah, March 14" },
  "session.deleteTitle": { en: "Delete this session?" },
  "session.deleteMessage": {
    en: "The transcript and summary will be permanently removed. This cannot be undone.",
  },

  // Session detail (session/[id]/page.tsx)
  "session.notFoundTitle": { en: "Session not found" },
  "session.notFoundBody": {
    en: "This session no longer exists or was recorded on a different device.",
  },
  "session.copyFailed": { en: "Couldn't copy" },
  "session.shareMd": { en: "Share .md" },
  "session.shareMdA11y": { en: "Share as Markdown" },
  "session.done": { en: "Done" },

  // Summary (session-body.tsx / summary-loading.tsx)
  "session.summarizing": { en: "Summarizing" },
  "session.captionReading": { en: "Reading the transcript…" },
  "session.captionFinding": { en: "Finding the key points…" },
  "session.captionWriting": { en: "Writing your summary…" },
  "session.summaryLabel": { en: "Summary" },
  "session.summaryFailed": { en: "Summary failed" },
  "session.summaryFailedStatus": { en: "Summary failed ({status})" },
  "session.summaryDisclaimer": {
    en: "Quranic and hadith references are best-effort recognition by the AI — verify against original sources before quoting or sharing.",
  },
  "session.summaryLanguage": { en: "Summary language" },
  "session.transcriptLabel": { en: "Transcript" },

  // Markdown export (handleDownloadMarkdown)
  "session.mdSummary": { en: "Summary" },
  "session.mdTranscript": { en: "Transcript" },
} satisfies NativeStrings;
