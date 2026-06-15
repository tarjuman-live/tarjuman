"use client";

import { useEffect, useRef } from "react";

/**
 * Curated list of known male system voices keyed by lowercased platform name.
 * The Web Speech API does not expose voice gender, so we match by `voice.name`
 * against this list. Per app policy, TTS always defaults to a male voice when
 * one is available for the requested language.
 *
 * Sources covered: macOS (built-in TTS voices), iOS, Windows SAPI, common
 * Android TTS voices. Add to this list when a target locale falls back to a
 * female voice unintentionally — the console warns when that happens.
 */
const KNOWN_MALE_VOICE_NAMES = new Set<string>([
  // macOS / iOS — multilingual, generally male
  "alex",
  "aaron",
  "albert",
  "arthur",
  "bahh",
  "boing",
  "bruce",
  "daniel",
  "fred",
  "junior",
  "ralph",
  "reed",
  "rishi",
  "tom",
  // macOS / iOS — Arabic
  "maged",
  // macOS / iOS — Spanish, French, German, Italian, Portuguese, etc.
  "diego",
  "jorge",
  "juan",
  "thomas",
  "yannick",
  "markus",
  "stefan",
  "luca",
  "paolo",
  "felipe",
  "joaquim",
  // macOS / iOS — Russian, Turkish, Indonesian, Malay
  "yuri",
  "tarik",
  "damayanti",
  // Windows SAPI common male
  "david",
  "mark",
  "george",
  "james",
  "richard",
  "ravi",
  // Google / Android (these may have multiple male variants per language)
  "google us english male",
  "google uk english male",
]);

function isKnownMaleVoice(voice: SpeechSynthesisVoice): boolean {
  const name = voice.name.toLowerCase();
  // Direct match
  if (KNOWN_MALE_VOICE_NAMES.has(name)) return true;
  // "Male" appears literally in some Android / Chrome voice names
  if (/\bmale\b/.test(name) && !/\bfemale\b/.test(name)) return true;
  // Some platforms prefix the language code: "en-us-x-tpd-local male"
  for (const known of KNOWN_MALE_VOICE_NAMES) {
    if (name.includes(known)) return true;
  }
  return false;
}

export interface TtsItem {
  id: string;
  text: string;
}

export interface UseTtsOptions {
  /** Master switch. When false, no new utterances queue and the current queue is cancelled. */
  enabled: boolean;
  /** True when the recording is paused — pause the synth, don't drop the queue. */
  paused: boolean;
  /** BCP-47 / ISO language code of the items being spoken (e.g. "en", "ar"). */
  language: string;
  /** Items to speak in order. The hook tracks which ids it has already spoken. */
  items: TtsItem[];
  /** Speaking rate (0.1 – 10). Default 1.0; live khutbah translation feels good at 1.05. */
  rate?: number;
}

/**
 * Live TTS playback over the browser's SpeechSynthesis API.
 *
 * Why SpeechSynthesis (vs Deepgram Aura / ElevenLabs / OpenAI TTS):
 *   Zero network latency — the synthesizer runs locally on the device.
 *   For live khutbah translation, latency beats voice quality. macOS and
 *   recent iOS have decent built-in voices for English and many other
 *   languages.
 *
 * Behavior:
 *   - Watches `items` for ids it hasn't spoken yet (tracked in a ref).
 *   - For each new item, queues a SpeechSynthesisUtterance. The browser's
 *     internal queue handles ordering — utterances play one after another.
 *   - When `paused` flips true: pause() the synth (the queue is preserved).
 *   - When `paused` flips back: resume().
 *   - When `enabled` flips false (or the hook unmounts): cancel() the queue
 *     so nothing keeps speaking after the user disabled audio or stopped
 *     the recording.
 *
 * iOS quirk: the very first speak() call must follow a user gesture or
 * Safari refuses. The user already tapped "record"; that gesture is enough
 * to authorize subsequent speak() calls in the same tab session.
 */
export function useTts({
  enabled,
  paused,
  language,
  items,
  rate = 1.05,
}: UseTtsOptions): void {
  // Track which ids we've already submitted to the synth queue so reordering
  // / state updates don't re-speak old items.
  const spokenIdsRef = useRef<Set<string>>(new Set());

  // Cache of available voices; refreshed on the `voiceschanged` event.
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Load voice list on mount + when the browser populates it asynchronously.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof speechSynthesis === "undefined") return;
    const refresh = () => {
      voicesRef.current = speechSynthesis.getVoices();
    };
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, []);

  // Pick the best voice for the given language. The Web Speech API does NOT
  // expose voice gender, so we match the voice name against a curated list
  // of platform male voices (macOS, iOS, Windows, common Android). Default
  // is always male per app policy. Falls back to first available match if
  // no male voice is installed for the language — and warns to the console
  // so we know when to extend the list.
  const pickVoice = (lang: string): SpeechSynthesisVoice | null => {
    const voices = voicesRef.current;
    if (voices.length === 0) return null;
    const langLower = lang.toLowerCase();
    const matches = voices.filter((v) =>
      v.lang.toLowerCase().startsWith(langLower)
    );
    if (matches.length === 0) return null;

    const male = matches.find((v) => isKnownMaleVoice(v));
    if (male) return male;

    // No known-male voice for this language. Per the male-voice-only policy,
    // do NOT fall back to an arbitrary voice — the platform default is often
    // female (e.g. Microsoft Zira on Windows; some languages ship female-only).
    // Return null so the caller skips speaking rather than reading the khutbah
    // aloud in a female voice.
    console.warn(
      `[tts] no known male voice for "${lang}" — skipping Web Speech (male-only policy). Available: ${matches
        .map((v) => `${v.name} (${v.lang})`)
        .join(", ")}`
    );
    return null;
  };

  // Watch items for new ones to speak.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    if (!enabled) return;

    const spoken = spokenIdsRef.current;
    for (const item of items) {
      if (spoken.has(item.id)) continue;
      if (!item.text || !item.text.trim()) {
        // Mark empty items as spoken so we don't re-evaluate them every render.
        spoken.add(item.id);
        continue;
      }
      spoken.add(item.id);
      const voice = pickVoice(language);
      if (!voice) continue; // male-only policy: skip if no known male voice
      try {
        const utt = new SpeechSynthesisUtterance(item.text);
        utt.lang = language;
        utt.rate = rate;
        utt.voice = voice;
        speechSynthesis.speak(utt);
      } catch {
        // Some browsers throw if speak is called outside a user gesture
        // before any prior speak. Not fatal — will retry on next item.
      }
    }
  }, [items, enabled, language, rate]);

  // Pause / resume the active synth queue, preserving order.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    if (!enabled) return;
    if (paused) {
      try {
        speechSynthesis.pause();
      } catch {}
    } else {
      try {
        speechSynthesis.resume();
      } catch {}
    }
  }, [paused, enabled]);

  // When disabled (toggle off) or unmount, cancel the queue completely.
  // Also reset the spoken-ids set so re-enabling later in the SAME session
  // doesn't replay everything — the live translator only adds NEW items.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    if (enabled) return;
    try {
      speechSynthesis.cancel();
    } catch {}
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (typeof speechSynthesis === "undefined") return;
      try {
        speechSynthesis.cancel();
      } catch {}
      spokenIdsRef.current = new Set();
    };
  }, []);
}
