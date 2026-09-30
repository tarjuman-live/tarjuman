import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "welcome-hero" builder. Prefer the web's MessageKeys
 * (t("record.copy") etc.) — only add strings here that the web doesn't have.
 * Key format: "<owner>.<name>"; English required.
 *
 * The hero fine print + its rotating language names are HARDCODED English on
 * the web (src/app/page.tsx:81-97, no MessageKey), so they live here.
 */
export const WELCOME_HERO_STRINGS = {
  /** page.tsx:82 — text before the rotating word. */
  "welcomeHero.finePrintLead": { en: "Free to start ·" },
  /** page.tsx:94-96 — text after the rotating word. */
  "welcomeHero.finePrintTail": {
    en: "into 30+ languages · Live transcription, translation & summaries · No card required",
  },
  /** page.tsx:85-91 — RotatingText items, in order. */
  "welcomeHero.rotArabic": { en: "Arabic" },
  "welcomeHero.rotUrdu": { en: "Urdu" },
  "welcomeHero.rotSpanish": { en: "Spanish" },
  "welcomeHero.rotFrench": { en: "French" },
  "welcomeHero.rotTurkish": { en: "Turkish" },
  "welcomeHero.rotIndonesian": { en: "Indonesian" },
  /** Accessibility label for the brand tile (tap scrolls to top; web links to "/"). */
  "welcomeHero.brandHome": { en: "Tarjuman — back to top" },

  // ── #try section (page.tsx:114-124 + try-live.tsx — hardcoded English on the web) ──
  /**
   * lp.trialSub says "right here in your browser"; the native app isn't a
   * browser, so this is the same line with the device wording.
   */
  "welcomeHero.trialSub": {
    en: "Pick a language, tap the mic, and start talking. You'll see it transcribed and translated live, right here on your phone.",
  },
  "welcomeHero.langEnglish": { en: "English" },
  "welcomeHero.langGerman": { en: "German" },
  "welcomeHero.trialTitle": { en: "Try it live" },
  "welcomeHero.trialListening": { en: "Listening" },
  "welcomeHero.trialSpeakLabel": { en: "Language you'll speak" },
  "welcomeHero.trialTargetLabel": { en: "Translate to" },
  /** Web: "Live mic transcription needs Chrome, Edge, or Safari." (browser-specific). */
  "welcomeHero.trialUnsupported": { en: "The live mic trial isn't available in the app yet." },
  "welcomeHero.trialUnsupportedSub": { en: "Or create a free account to use the full recorder." },
  "welcomeHero.trialDenied": { en: "Mic access was blocked." },
  "welcomeHero.trialDeniedSub": { en: "Allow the microphone in Settings, then try again." },
  "welcomeHero.trialIdle": { en: "Press the mic and start speaking." },
  "welcomeHero.trialIdleSub": { en: "Your words appear in {source}, translated to {target} as you go." },
  "welcomeHero.trialSaySomething": { en: "Listening… say something." },
  "welcomeHero.trialTranslating": { en: "…translating" },
  "welcomeHero.trialTranslationUnavailable": { en: "(translation unavailable)" },
  "welcomeHero.trialStop": { en: "Stop" },
  "welcomeHero.trialSecondsLeft": { en: "{n}s left in the trial" },
  "welcomeHero.trialTryAgain": { en: "Try again" },
  "welcomeHero.trialStart": { en: "Start speaking" },
  /** Web: "No sign-up · runs in your browser". */
  "welcomeHero.trialNoSignup": { en: "No sign-up · runs on your device" },
  "welcomeHero.trialEndedTitle": { en: "That's Tarjuman." },
  "welcomeHero.trialEndedBody": {
    en: "Create a free account to record full lectures, translate Arabic khutbahs with terminology kept intact, and save every transcript.",
  },
  "welcomeHero.trialGetStarted": { en: "Get started free" },
  "welcomeHero.trialLimit": { en: "Trial limit reached." },
  "welcomeHero.trialErrNetwork": {
    en: "Can't reach the speech service. Check your internet connection.",
  },
  "welcomeHero.trialErrLanguage": {
    en: "Live recognition isn't available for {lang} on this device. Pick a different language.",
  },
  "welcomeHero.trialErrNoMic": { en: "No microphone was detected." },
  "welcomeHero.trialErrOther": { en: "Speech recognition error: {error}" },
  "welcomeHero.trialErrSilent": {
    en: "Not picking up any speech yet. Check that your mic works and you're speaking.",
  },
} satisfies NativeStrings;
