import type { NativeStrings } from "../types";

/**
 * Native-only strings owned by the "record" builder. Prefer the web's MessageKeys
 * (t("record.copy") etc.) — only add strings here that the web doesn't have.
 * Key format: "<owner>.<name>"; English required.
 *
 * Most of these are hard-coded English on the web (recording-shell.tsx,
 * language-selector.tsx, language-picker-sheet.tsx, positioning-tips.tsx,
 * mic-error-state.tsx, upgrade-card.tsx, account-menu.tsx, record/page.tsx),
 * so they have no web MessageKey. The copy is the web's, verbatim.
 */
export const RECORD_STRINGS = {
  // Idle
  "record.brand": { en: "Tarjuman" },
  "record.starting": { en: "Starting…" },
  "record.startRecording": { en: "Start recording" },
  "record.sessionsUsage": { en: "{used} of {limit} sessions this month" },
  "record.recent": { en: "Recent" },
  "record.untitled": { en: "Untitled session" },
  "record.notSavingTitle": { en: "Not saving" },
  "record.notSavingBody": { en: "Couldn't create a session — this recording won't be saved." },

  // Language selector + picker sheet
  "record.listeningTo": { en: "Listening to" },
  "record.translateTo": { en: "Translate to" },
  "record.swapLanguages": { en: "Swap source and target languages" },
  "record.sourceLanguage": { en: "Source Language" },
  "record.targetLanguage": { en: "Target Language" },
  "record.sourceLanguageSub": { en: "Language being spoken" },
  "record.targetLanguageSub": { en: "Language you want to read" },
  "record.searchLanguages": { en: "Search languages..." },
  "record.clearSearch": { en: "Clear search" },
  "record.noLanguages": { en: "No languages found" },

  // Positioning tips
  "record.tipsCardBody": { en: "Where to hold your phone for a clean transcript" },
  "record.tipsIntro": {
    en: "Tarjuman captures audio from speakers in halls and masjids — a few seconds of setup makes a big difference.",
  },
  "record.tip1Title": { en: "Get close to the speaker" },
  "record.tip1Body": {
    en: "1–2 metres is ideal. The further away, the more the room itself ends up in the recording.",
  },
  "record.tip2Title": { en: "Point the bottom of your phone at the sound" },
  "record.tip2Body": {
    en: "Most mics are at the bottom edge. Aiming them at the source picks up speech more clearly.",
  },
  "record.tip3Title": { en: "Don't cover the mic" },
  "record.tip3Body": { en: "A hand or a thick case over the bottom edge muffles everything." },
  "record.tip4Title": { en: "Quieter rooms = better transcripts" },
  "record.tip4Body": {
    en: "Crowd noise, AC hum, and echo all reduce accuracy. We filter what we can — the rest is physics.",
  },
  "record.tipsMeterHint": {
    en: "Watch the audio meter while recording. If it stays low for more than a couple of seconds, move closer to the speaker.",
  },

  // Recording shell
  "record.connecting": { en: "Connecting…" },
  "record.reconnecting": { en: "Reconnecting… (attempt {n})" },
  "record.offline": { en: "Transcription offline" },
  "record.unavailableTitle": { en: "Transcription unavailable" },
  "record.interruptedTitle": { en: "Recording paused by your device" },
  "record.interruptedBody": {
    en: "Your phone interrupted the mic (a call, Siri, or another app). Tap here to resume capturing.",
  },
  "record.stackedView": { en: "Stacked transcript view" },
  "record.splitView": { en: "Split transcript view" },
  "record.speakersDetected": { en: "{n} speakers detected" },
  "record.mainSpeakerOnly": { en: "Main speaker only" },
  "record.mainSpeakerOnlyOn": { en: "✓ Main speaker only" },
  "record.pauseRecording": { en: "Pause recording" },
  "record.resumeRecording": { en: "Resume recording" },
  "record.stopRecording": { en: "Stop recording" },
  "record.speakNearDevice": { en: "Speak or play audio through a speaker near your device." },
  "record.connectingTranscriber": { en: "Connecting to the transcriber…" },
  "record.audioLevel": { en: "Audio level: {quality}" },
  "record.strongSignal": { en: "Strong signal" },

  // Mic error
  "record.micDeniedTitle": { en: "Microphone access denied" },
  "record.micDeniedBody": {
    en: "Tarjuman needs microphone access to transcribe audio. Open Settings → Privacy → Microphone, allow Tarjuman, then tap Try again.",
  },
  "record.micFailedTitle": { en: "Couldn't start recording" },
  "record.micFailedBody": { en: "Something went wrong. Please try again." },

  // Upgrade card
  "record.limitTitle": { en: "Monthly limit reached" },
  "record.limitBody": {
    en: "You've used all {limit} free sessions this month. Upgrade to Tarjuman Pro for unlimited recording.",
  },
  "record.upgrade": { en: "Upgrade" },
  // Session screen summary cap (web session-body.tsx, hard-coded English there)
  "record.summaryLimitTitle": { en: "Summary limit reached" },
  "record.summaryLimitBody": {
    en: "You've used all {limit} free summaries this month. Upgrade to Tarjuman Pro for unlimited AI summaries.",
  },

  // Account menu (idle header)
  "record.accountMenu": { en: "Account menu" },
  "record.signedIn": { en: "Signed in" },
  "record.signOut": { en: "Sign out" },
} satisfies NativeStrings;
