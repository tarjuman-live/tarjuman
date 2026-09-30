import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "pro-tools" builder. Prefer the web's MessageKeys
 * (t("record.copy") etc.) — only add strings here that the web doesn't have.
 * Key format: "<owner>.<name>"; English required.
 *
 * The web's session/pro-ai-tools.tsx, session/lang-dropdown.tsx and
 * billing/upgrade-card.tsx hard-code these in English (no MessageKey), so
 * they live here. "Generating…" reuses the web's `record.generating`.
 */
export const PRO_TOOLS_STRINGS = {
  "proTools.aiTools": { en: "AI tools" },
  "proTools.proBadge": { en: "✦ Pro" },
  "proTools.lockedTitle": { en: "Unlock AI tools with Pro" },
  "proTools.lockedMessage": {
    en: "AI study notes, Ask-the-lecture, and any-language transcript translation are Tarjuman Pro features.",
  },
  "proTools.upgrade": { en: "Upgrade" },

  "proTools.tabNotes": { en: "Study notes" },
  "proTools.tabAsk": { en: "Ask" },
  "proTools.tabTranslate": { en: "Translate" },

  "proTools.generateNotes": { en: "Generate study notes" },
  "proTools.regenerate": { en: "Regenerate" },

  "proTools.askHint": {
    en: "Ask anything about this lecture — answers come only from the transcript.",
  },
  "proTools.askPlaceholder": { en: "Ask about the lecture…" },
  "proTools.askSubmit": { en: "Ask" },
  "proTools.thinking": { en: "…thinking" },

  "proTools.translateHint": {
    en: "Translate the whole lecture (from {lang}) into another language.",
  },
  "proTools.translate": { en: "Translate" },
  "proTools.translating": { en: "Translating…" },
  "proTools.retranslate": { en: "Retranslate" },

  "proTools.requestFailed": { en: "Request failed ({status})" },
  "proTools.language": { en: "Language" },
} satisfies NativeStrings;
