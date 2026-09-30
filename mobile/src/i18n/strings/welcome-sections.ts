import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "welcome-sections" builder. Prefer the web's MessageKeys
 * (t("record.copy") etc.) — only add strings here that the web doesn't have.
 * Key format: "<owner>.<name>"; English required.
 *
 * The web hardcodes these in English (landing/live-demo.tsx caption, footer
 * social aria-labels); they are keyed here so the native app can localize them.
 */
export const WELCOME_SECTIONS_STRINGS = {
  "welcome-sections.demoCaption": {
    en: "Live preview · actual transcription runs on your device",
  },
  "welcome-sections.demoA11y": {
    en: "Animated preview of a live transcription and translation",
  },
  "welcome-sections.faqToggleHint": {
    en: "Shows or hides the answer",
  },
  "welcome-sections.openInstagram": { en: "Instagram" },
  "welcome-sections.openX": { en: "X" },
  "welcome-sections.openTikTok": { en: "TikTok" },
  "welcome-sections.contactA11y": { en: "Email us" },
} satisfies NativeStrings;
