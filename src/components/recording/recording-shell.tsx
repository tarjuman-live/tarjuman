"use client";

import { useEffect, useState } from "react";
import { COLORS } from "@/lib/constants";
import { formatDuration, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { AudioVisualizer } from "./audio-visualizer";
import { LiveTranscript } from "./live-transcript";
import { useSessionTimer } from "@/hooks/use-session-timer";
import type { ConnectionState, LiveSegment } from "@/types";

interface RecordingShellProps {
  sourceLang: string;
  targetLang: string;
  analyser: AnalyserNode | null;
  /** True when recording or paused — drives the wake-lock-style "session running" state. */
  active: boolean;
  /** True only while paused (active && paused). Controls timer freeze + UI. */
  paused: boolean;
  segments: LiveSegment[];
  interimText: string;
  connectionState: ConnectionState;
  reconnectAttempt: number;
  transcriptionError: string | null;
  translations?: Record<string, string>;
  /** Whether translation TTS is on. Controlled by parent via `onTtsToggle`. */
  ttsEnabled: boolean;
  onTtsToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const MAIN_SPEAKER_PREF_KEY = "livetranscribe:main-speaker-only";

export function RecordingShell({
  sourceLang,
  targetLang,
  analyser,
  active,
  paused,
  segments,
  interimText,
  connectionState,
  reconnectAttempt,
  transcriptionError,
  translations,
  ttsEnabled,
  onTtsToggle,
  onPause,
  onResume,
  onStop,
}: RecordingShellProps) {
  const elapsed = useSessionTimer(active, paused);
  const [pulsePhase, setPulsePhase] = useState(0);
  const [mainSpeakerOnly, setMainSpeakerOnly] = useState(false);

  // Hydrate the toggle preference from localStorage so it persists across
  // sessions. Done after mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMainSpeakerOnly(localStorage.getItem(MAIN_SPEAKER_PREF_KEY) === "1");
  }, []);

  const toggleMainSpeaker = () => {
    setMainSpeakerOnly((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(MAIN_SPEAKER_PREF_KEY, next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  };

  // Show the toggle only once we've actually seen multiple speakers — so
  // single-speaker sessions stay uncluttered.
  const speakerSet = new Set<number>();
  for (const s of segments) {
    if (typeof s.speaker === "number") speakerSet.add(s.speaker);
  }
  const showSpeakerToggle = speakerSet.size > 1;

  useEffect(() => {
    if (!active || paused) return;
    const t = setInterval(() => setPulsePhase((p) => (p + 1) % 3), 600);
    return () => clearInterval(t);
  }, [active, paused]);

  // Spacebar toggles pause/resume. Only when no input/textarea is focused —
  // future text-editing UI on this screen mustn't fight the shortcut.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      if (paused) onResume();
      else onPause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, paused, onPause, onResume]);

  const isReconnecting = connectionState === "reconnecting";
  const isConnecting = connectionState === "connecting";
  const isTranscriptionError = connectionState === "error";

  const statusColor = paused ? COLORS.amber : COLORS.red;
  const statusLabel = paused ? "Paused" : "Recording";

  return (
    <div className="flex flex-col flex-1" style={{ paddingBottom: 60 }}>
      {/* Header: status dot + label + timer */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div className="flex items-center gap-[6px]">
          <div
            className="w-[10px] h-[10px] rounded-full"
            style={{
              background: statusColor,
              boxShadow: `0 0 8px ${statusColor}60`,
            }}
          />
          <span
            className="text-[13px] font-bold"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </span>
        </div>
        <div
          className="text-xl font-bold tabular-nums"
          style={{ color: COLORS.w, fontFamily: "var(--font-mono)" }}
        >
          {formatDuration(elapsed)}
        </div>
      </div>

      {/* Language bar + connection status */}
      <div
        className="px-5 py-2 flex items-center justify-center gap-2"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <span className="text-xs font-semibold" style={{ color: COLORS.t3 }}>
          {getLangName(sourceLang)}
        </span>
        <span className="text-xs" style={{ color: COLORS.t4 }}>
          →
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: COLORS.accent }}
        >
          {getLangName(targetLang)}
        </span>
        {connectionState === "connected" && !paused && (
          <div className="flex gap-[3px] ml-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1 h-1 rounded-full transition-colors"
                style={{
                  background:
                    pulsePhase === i ? COLORS.accent : `${COLORS.accent}30`,
                }}
              />
            ))}
          </div>
        )}
        {(isReconnecting || isConnecting) && (
          <span
            className="ml-2 text-[11px] font-semibold"
            style={{ color: COLORS.amber }}
          >
            {isReconnecting
              ? `Reconnecting… (attempt ${reconnectAttempt})`
              : "Connecting…"}
          </span>
        )}
        {isTranscriptionError && (
          <span
            className="ml-2 text-[11px] font-semibold"
            style={{ color: COLORS.red }}
          >
            Transcription offline
          </span>
        )}
      </div>

      {/* Inline error banner with the actual root cause so users can act on it. */}
      {isTranscriptionError && transcriptionError && (
        <div
          className="mx-5 mt-3 px-4 py-3 rounded-2xl text-[12px]"
          style={{
            background: COLORS.redSoft,
            border: `1px solid ${COLORS.red}40`,
            color: COLORS.w,
          }}
          role="alert"
        >
          <div className="section-label mb-1" style={{ color: COLORS.red }}>
            Transcription unavailable
          </div>
          <div style={{ color: COLORS.t2 }}>{transcriptionError}</div>
        </div>
      )}

      {/* Compact visualizer strip — frozen while paused so users see the freeze. */}
      <div
        className="px-5 py-2"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <AudioVisualizer
          analyser={analyser}
          active={active && !paused}
          compact
          barCount={20}
        />
      </div>

      {/* Speaker filter — only appears once multiple speakers are detected. */}
      {showSpeakerToggle && (
        <div
          className="px-5 py-2 flex items-center justify-between"
          style={{ borderBottom: `1px solid ${COLORS.border}` }}
        >
          <span className="text-[11px]" style={{ color: COLORS.t3 }}>
            {speakerSet.size} speakers detected
          </span>
          <button
            type="button"
            onClick={toggleMainSpeaker}
            className="text-[11px] font-semibold px-3 py-1 rounded-md cursor-pointer transition-colors"
            style={{
              background: mainSpeakerOnly
                ? COLORS.accent
                : COLORS.surfaceLight,
              color: mainSpeakerOnly ? "#0A0F1C" : COLORS.t2,
              border: mainSpeakerOnly
                ? "none"
                : `1px solid ${COLORS.borderLight}`,
            }}
          >
            {mainSpeakerOnly ? "✓ Main speaker only" : "Main speaker only"}
          </button>
        </div>
      )}

      {/* Transcript (the hero) */}
      <LiveTranscript
        segments={segments}
        interimText={paused ? "" : interimText}
        sourceLang={sourceLang}
        translations={translations}
        targetLang={targetLang}
        mainSpeakerOnly={mainSpeakerOnly}
      />

      {/* Controls */}
      <div
        className="px-5 py-4 flex justify-center items-center gap-4"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        {/* Translation audio toggle — TTS the translation aloud as it arrives. */}
        <button
          type="button"
          onClick={onTtsToggle}
          aria-label={
            ttsEnabled ? "Mute translation audio" : "Speak translation aloud"
          }
          aria-pressed={ttsEnabled}
          title={
            ttsEnabled
              ? "Translation audio: ON"
              : "Translation audio: OFF"
          }
          className="w-11 h-11 rounded-2xl cursor-pointer grid place-items-center transition-transform active:scale-95"
          style={{
            background: ttsEnabled ? COLORS.accentSoft : COLORS.surface,
            border: `1px solid ${
              ttsEnabled ? `${COLORS.accent}40` : COLORS.borderLight
            }`,
          }}
        >
          <Icon
            name={ttsEnabled ? "speaker" : "speakerOff"}
            size={18}
            color={ttsEnabled ? COLORS.accent : COLORS.t3}
          />
        </button>

        {paused ? (
          <button
            type="button"
            onClick={onResume}
            aria-label="Resume recording"
            className="w-14 h-14 rounded-2xl cursor-pointer grid place-items-center transition-transform active:scale-95"
            style={{
              background: COLORS.accentSoft,
              border: `1px solid ${COLORS.accent}40`,
            }}
          >
            <Icon name="play" size={22} color={COLORS.accent} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause recording"
            className="w-14 h-14 rounded-2xl cursor-pointer grid place-items-center transition-transform active:scale-95"
            style={{
              background: COLORS.amberSoft,
              border: `1px solid ${COLORS.amber}40`,
            }}
          >
            <Icon name="pause" size={22} color={COLORS.amber} />
          </button>
        )}
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop recording"
          className="w-14 h-14 rounded-2xl cursor-pointer grid place-items-center transition-transform active:scale-95"
          style={{
            background: COLORS.redSoft,
            border: `1px solid ${COLORS.red}30`,
          }}
        >
          <Icon name="stop" size={22} color={COLORS.red} />
        </button>
      </div>
    </div>
  );
}
