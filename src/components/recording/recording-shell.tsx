"use client";

import { useEffect, useState } from "react";
import { COLORS } from "@/lib/constants";
import { formatDuration, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { AudioVisualizer } from "./audio-visualizer";
import { LiveTranscript } from "./live-transcript";
import { SplitTranscript } from "./split-transcript";
import { useSessionTimer } from "@/hooks/use-session-timer";
import { useLocale } from "@/lib/i18n/locale-context";
import type { ConnectionState, LiveSegment } from "@/types";

/** Transcript view mode: stacked source+translation cards, or two split panes. */
export type TranscriptLayout = "paired" | "split";

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
  /** Verse/hadith merge data from the translator. */
  merges?: Record<
    string,
    { fromIds: string[]; combinedSourceText: string; combinedTranslatedText: string }
  >;
  /** Set of segment ids that were merged into a parent (hide from render). */
  suppressedIds?: Set<string>;
  /** Segments filtered as noise server-side (single-word / off-language). */
  filteredIds?: Set<string>;
  /** Segment id → translation error (failed after retries). */
  errors?: Record<string, string>;
  /** Segment ids whose translation is currently in flight. */
  pending?: Set<string>;
  /** Clear a segment's error and re-attempt its translation. */
  onRetry?: (id: string) => void;
  /** Transcript view mode + setter (persisted by the parent). */
  transcriptLayout: TranscriptLayout;
  onSetLayout: (layout: TranscriptLayout) => void;
  /** Whether to keep only the dominant speaker. Controlled by the parent. */
  mainSpeakerOnly: boolean;
  onMainSpeakerToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

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
  merges,
  suppressedIds,
  filteredIds,
  errors,
  pending,
  onRetry,
  transcriptLayout,
  onSetLayout,
  mainSpeakerOnly,
  onMainSpeakerToggle,
  onPause,
  onResume,
  onStop,
}: RecordingShellProps) {
  const { t } = useLocale();
  const elapsed = useSessionTimer(active, paused);
  const [pulsePhase, setPulsePhase] = useState(0);

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
  const statusLabel = paused ? t("record.paused") : t("record.recording");

  // Identical props for both transcript views, so the toggle is a true drop-in.
  const transcriptProps = {
    segments,
    interimText: paused ? "" : interimText,
    sourceLang,
    translations,
    targetLang,
    merges,
    suppressedIds,
    filteredIds,
    errors,
    pending,
    onRetry,
    mainSpeakerOnly,
  };

  return (
    // Desktop: center the whole recording view at a comfortable reading width
    // so the transcript isn't stretched edge-to-edge across a wide monitor.
    <div
      className="flex flex-col flex-1 lg:max-w-5xl lg:mx-auto lg:w-full"
      style={{ paddingBottom: 60 }}
    >
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
        className="px-5 py-2 flex items-center justify-center gap-2 relative"
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

        {/* Layout toggle — stacked cards ⇄ split (each language its own half). */}
        <div
          className="absolute right-3 top-1/2 -translate-y-1/2 flex rounded-lg overflow-hidden"
          style={{ border: `1px solid ${COLORS.borderLight}` }}
        >
          {(["paired", "split"] as const).map((mode) => {
            const on = transcriptLayout === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onSetLayout(mode)}
                aria-pressed={on}
                aria-label={
                  mode === "paired"
                    ? "Stacked transcript view"
                    : "Split transcript view"
                }
                title={
                  mode === "paired"
                    ? "Stacked cards"
                    : "Split view — each language in its own half"
                }
                className="w-7 h-6 grid place-items-center cursor-pointer transition-colors"
                style={{ background: on ? COLORS.accentSoft : "transparent" }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke={on ? COLORS.accent : COLORS.t3}
                  strokeWidth="1.6"
                >
                  {mode === "paired" ? (
                    <>
                      <rect x="2.5" y="3" width="11" height="3.5" rx="1" />
                      <rect x="2.5" y="9.5" width="11" height="3.5" rx="1" />
                    </>
                  ) : (
                    <>
                      <rect x="2.5" y="3" width="4.5" height="10" rx="1" />
                      <rect x="9" y="3" width="4.5" height="10" rx="1" />
                    </>
                  )}
                </svg>
              </button>
            );
          })}
        </div>
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
            onClick={onMainSpeakerToggle}
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
      {transcriptLayout === "split" ? (
        <SplitTranscript {...transcriptProps} />
      ) : (
        <LiveTranscript {...transcriptProps} />
      )}

      {/* Controls */}
      <div
        className="px-5 py-4 flex justify-center items-center gap-4"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        {paused ? (
          <button
            type="button"
            onClick={onResume}
            aria-label="Resume recording"
            className="rec-ctl rec-ctl-resume w-14 h-14 rounded-full cursor-pointer grid place-items-center"
          >
            <Icon name="play" size={22} color={COLORS.accent} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause recording"
            className="rec-ctl rec-ctl-pause w-14 h-14 rounded-full cursor-pointer grid place-items-center"
          >
            <Icon name="pause" size={22} color={COLORS.amber} />
          </button>
        )}
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop recording"
          className="rec-ctl rec-ctl-stop w-14 h-14 rounded-full cursor-pointer grid place-items-center"
        >
          <Icon name="stop" size={22} color={COLORS.red} />
        </button>
      </div>
    </div>
  );
}
