"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { COLORS, SEGMENT_FLUSH_INTERVAL_MS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { LanguageSelector } from "@/components/recording/language-selector";
import { IdleRecordButton } from "@/components/recording/record-button";
import { RecentSessionsPreview } from "@/components/recording/recent-sessions-preview";
import { RecordingShell } from "@/components/recording/recording-shell";
import { MicErrorState } from "@/components/recording/mic-error-state";
import { PositioningTips } from "@/components/recording/positioning-tips";
import { AccountMenu } from "@/components/auth/account-menu";
import { haptics } from "@/lib/haptics";
import {
  CompletedView,
  type CompletedSession,
} from "@/components/session/completed-view";
import { useRecorder } from "@/hooks/use-recorder";
import { useDeepgram } from "@/hooks/use-deepgram";
import { useTranslator } from "@/hooks/use-translator";
import { useSessionTimer } from "@/hooks/use-session-timer";
import { useOpenaiTts } from "@/hooks/use-openai-tts";

const TTS_PREF_KEY = "livetranscribe:tts-enabled";

export default function RecordPage() {
  const [sourceLang, setSourceLang] = useState("ar");
  const [targetLang, setTargetLang] = useState("en");
  const [completedSession, setCompletedSession] =
    useState<CompletedSession | null>(null);

  // Convex mutations. These hooks return imperative callables — calling them
  // sends a typed mutation to the Convex backend and resolves with the
  // function's return value.
  const createSession = useMutation(api.sessions.createSession);
  const addSegments = useMutation(api.sessions.addSegments);
  const pauseSessionM = useMutation(api.sessions.pauseSession);
  const resumeSessionM = useMutation(api.sessions.resumeSession);
  const completeSessionM = useMutation(api.sessions.completeSession);
  const saveSummaryM = useMutation(api.sessions.saveSummary);
  const updateSegmentMerge = useMutation(api.sessions.updateSegmentMerge);

  // Default TTS to ON — the user explicitly asked for live audio. They can
  // mute it from the toggle in the recording shell; the choice persists.
  const [ttsEnabled, setTtsEnabled] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(TTS_PREF_KEY);
    if (stored !== null) setTtsEnabled(stored === "1");
  }, []);
  const toggleTts = () => {
    setTtsEnabled((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  };

  const recorder = useRecorder();
  const isActive =
    recorder.phase === "recording" || recorder.phase === "paused";
  const isPrewarmed = recorder.phase === "prewarmed";

  // Pre-warm the audio pipeline + Deepgram WS as soon as the page mounts,
  // but ONLY if mic permission is already granted — never trigger an
  // unsolicited permission prompt. The first time a user reaches /record
  // there's no prewarm; from the second visit onward, their first word
  // transcribes without the cold-start handshake swallow.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        if (result.state === "granted") {
          void recorder.prewarm();
        }
      })
      .catch(() => {
        // Older Safari / Firefox lack mic-permission querying — skip prewarm.
      });
    return () => {
      cancelled = true;
    };
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deepgram = useDeepgram({
    pcmNode: recorder.pcmNode,
    sourceLanguage: sourceLang,
    // Keep the WS alive across prewarm + active recording. paused gates
    // outbound frames so prewarm doesn't accidentally leak audio.
    enabled: isActive || isPrewarmed,
    paused: recorder.phase === "paused" || isPrewarmed,
  });

  const translator = useTranslator({
    segments: deepgram.segments,
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    // Parallel-engine pass: hand the rolling PCM buffer to the translator
    // so each segment also gets a Whisper transcription; Claude reconciles
    // both Arabic versions before translating. Falls back silently to
    // Deepgram-only when OPENAI_API_KEY isn't set.
    audioBuffer: deepgram.audioBuffer,
  });

  // Live audio of translations.
  const ttsItems = useMemo(
    () =>
      Object.entries(translator.translations).map(([id, text]) => ({
        id,
        text,
      })),
    [translator.translations]
  );
  // OpenAI TTS for natural-sounding voice output, with automatic fallback
  // to the browser's Web Speech API when OPENAI_API_KEY isn't set or the
  // upstream call fails. Same trigger as the old useTts — translator items
  // arriving in `ttsItems` get spoken in arrival order.
  useOpenaiTts({
    enabled: ttsEnabled && isActive,
    paused: recorder.phase === "paused",
    language: targetLang,
    items: ttsItems,
  });

  const elapsed = useSessionTimer(isActive, recorder.phase === "paused");
  const elapsedRef = useRef(elapsed);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // ─── Persistence ──────────────────────────────────────────────────────
  // `createSession` resolves asynchronously (~100-300ms over the WebSocket
  // to Convex). During that window, segments may already be arriving from
  // Deepgram; we hold them locally until the id lands, then flush.
  //
  // `createSessionPromiseRef` lets `handleStop` await the in-flight create
  // before tearing down — without this, a fast tap of stop within 300ms of
  // record would leave the snapshot with `_id === null` and we'd never
  // mark the session complete in the DB.
  const sessionIdRef = useRef<Id<"sessions"> | null>(null);
  const createSessionPromiseRef = useRef<Promise<Id<"sessions">> | null>(null);
  const flushedIdsRef = useRef<Set<string>>(new Set());
  // Mirror the latest source/target language into a ref so the imperative
  // flushSegments() callback can read current values without being rebound.
  // Synced in an effect to avoid writing ref.current during render — that
  // pattern can produce torn reads under concurrent rendering.
  const langsRef = useRef({ source: sourceLang, target: targetLang });
  useEffect(() => {
    langsRef.current = { source: sourceLang, target: targetLang };
  }, [sourceLang, targetLang]);

  const flushSegments = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const flushed = flushedIdsRef.current;
    const sourceTargetSame =
      langsRef.current.source === langsRef.current.target;

    const ready = deepgram.segments.filter((seg) => {
      if (!seg.isFinal || flushed.has(seg.id)) return false;
      // Don't persist noise — single-word / off-language segments the
      // translator dropped server-side. They'd just clutter the saved
      // session.
      if (translator.filteredIds.has(seg.id)) {
        // Mark as flushed so we don't reconsider it on every tick.
        flushed.add(seg.id);
        return false;
      }
      if (sourceTargetSame) return true;
      return translator.translations[seg.id] !== undefined;
    });

    if (ready.length === 0) return;

    const stored = ready.map((seg) => {
      const merge = translator.merges[seg.id];
      return {
        id: seg.id,
        sourceText: seg.text,
        translatedText: sourceTargetSame
          ? seg.text
          : translator.translations[seg.id] ?? "",
        timestamp: seg.timestamp,
        // Include verse/hadith merge metadata on first flush when the
        // translator returned a merge before the flush tick fires.
        ...(merge
          ? {
              mergedFromIds: merge.fromIds,
              combinedSourceText: merge.combinedSourceText,
              combinedTranslatedText: merge.combinedTranslatedText,
            }
          : {}),
      };
    });

    // Fire-and-forget. Convex queues mutations and applies them in order;
    // on transient WS disconnect they retry automatically, so we don't need
    // our own retry layer.
    void addSegments({ sessionId, segments: stored });
    for (const seg of ready) flushed.add(seg.id);
  };

  // Late-merge effect: when the translator emits a merge AFTER the parent
  // segment was already flushed to Convex, patch the saved row so the
  // saved-session view shows the merged display.
  const mergedFlushedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const flushed = flushedIdsRef.current;
    const alreadyPatched = mergedFlushedRef.current;
    for (const [parentId, merge] of Object.entries(translator.merges)) {
      if (!flushed.has(parentId)) continue; // will be included in next flush
      if (alreadyPatched.has(parentId)) continue;
      alreadyPatched.add(parentId);
      void updateSegmentMerge({
        sessionId,
        parentSegmentId: parentId,
        mergedFromIds: merge.fromIds,
        combinedSourceText: merge.combinedSourceText,
        combinedTranslatedText: merge.combinedTranslatedText,
      });
    }
  }, [translator.merges, updateSegmentMerge]);

  // 5s flush tick during active recording.
  useEffect(() => {
    if (recorder.phase !== "recording") return;
    const id = window.setInterval(flushSegments, SEGMENT_FLUSH_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.phase]);

  // Clear transient state + create the persistent session record on every
  // fresh "starting" transition.
  useEffect(() => {
    if (recorder.phase === "starting") {
      deepgram.resetTranscript();
      translator.reset();
      flushedIdsRef.current = new Set();
      mergedFlushedRef.current = new Set();
      sessionIdRef.current = null;
      const promise = createSession({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      });
      createSessionPromiseRef.current = promise;
      void promise.then((id) => {
        sessionIdRef.current = id;
        // Drain anything that arrived during the create round-trip.
        flushSegments();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.phase]);

  const handleStart = () => {
    setCompletedSession(null);
    haptics.start();
    void recorder.start();
  };

  const handlePause = () => {
    flushSegments();
    if (sessionIdRef.current)
      void pauseSessionM({ sessionId: sessionIdRef.current });
    haptics.pause();
    recorder.pause();
  };

  const handleResume = () => {
    if (sessionIdRef.current)
      void resumeSessionM({ sessionId: sessionIdRef.current });
    haptics.resume();
    recorder.resume();
  };

  const handleStop = () => {
    haptics.stop();
    const finalDuration = elapsedRef.current;
    const captured = {
      segments: deepgram.segments,
      translations: translator.translations,
      merges: translator.merges,
      sourceLang,
      targetLang,
    };

    void (async () => {
      // If user stopped within the createSession round-trip window, wait
      // for the id to land before tearing down. Otherwise the snapshot
      // would lose `_id` and Convex would never see completeSession.
      let sessionId = sessionIdRef.current;
      if (!sessionId && createSessionPromiseRef.current) {
        try {
          sessionId = await createSessionPromiseRef.current;
        } catch {
          /* createSession failed — proceed without a persisted id */
        }
      }

      flushSegments();
      await recorder.stop();
      if (sessionId) {
        // Final flush after the recorder tears down — Convex's mutation
        // queue ensures addSegments applies before completeSession.
        flushSegments();
        void completeSessionM({ sessionId, duration: finalDuration });
      }
      const snapshot: CompletedSession = {
        _id: sessionId,
        segments: captured.segments,
        translations: captured.translations,
        merges: captured.merges,
        durationSec: finalDuration,
        sourceLang: captured.sourceLang,
        targetLang: captured.targetLang,
      };
      setCompletedSession(snapshot);
      sessionIdRef.current = null;
      createSessionPromiseRef.current = null;
      flushedIdsRef.current = new Set();
    })();
  };

  const handleSummaryGenerated = (summary: string) => {
    if (!completedSession?._id) return;
    void saveSummaryM({
      sessionId: completedSession._id as Id<"sessions">,
      summary,
      summaryLanguage: completedSession.targetLang,
    });
  };

  const handleNewRecording = () => {
    setCompletedSession(null);
  };

  // ─── Render ───────────────────────────────────────────────────────────

  if (completedSession) {
    return (
      <CompletedView
        session={completedSession}
        onNewRecording={handleNewRecording}
        onSummaryGenerated={handleSummaryGenerated}
      />
    );
  }

  // Only render the recording shell when the user has actually started a
  // session (phase = recording or paused). The brief "starting" phase that
  // fires during `prewarm()` on page mount must stay invisible — otherwise
  // the user lands on /record, sees the recording UI flash for ~200ms while
  // the audio pipeline opens in the background, then bounces back to idle.
  if (isActive) {
    return (
      <RecordingShell
        sourceLang={sourceLang}
        targetLang={targetLang}
        analyser={recorder.analyser}
        active={isActive}
        paused={recorder.phase === "paused"}
        segments={deepgram.segments}
        interimText={deepgram.interimText}
        connectionState={deepgram.connectionState}
        reconnectAttempt={deepgram.reconnectAttempt}
        transcriptionError={deepgram.error}
        translations={translator.translations}
        merges={translator.merges}
        suppressedIds={translator.suppressedIds}
        filteredIds={translator.filteredIds}
        ttsEnabled={ttsEnabled}
        onTtsToggle={toggleTts}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
      />
    );
  }

  if (recorder.phase === "error") {
    return (
      <div className="flex flex-col flex-1" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }}>
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: `1px solid ${COLORS.border}` }}
        >
          <div className="flex items-center gap-2">
            <Icon name="globe" size={18} color={COLORS.accent} />
            <span
              className="text-base font-bold"
              style={{ color: COLORS.w }}
            >
              LiveTranscribe
            </span>
          </div>
        </div>
        <MicErrorState
          permissionDenied={recorder.permissionDenied}
          unavailable={recorder.unavailable}
          message={recorder.error}
          onRetry={handleStart}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }}>
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div className="flex items-center gap-2">
          <Icon name="globe" size={18} color={COLORS.accent} />
          <span className="text-base font-bold" style={{ color: COLORS.w }}>
            LiveTranscribe
          </span>
        </div>
        <AccountMenu />
      </div>

      <div className="flex-1 flex flex-col p-5 gap-4">
        <LanguageSelector
          sourceLang={sourceLang}
          targetLang={targetLang}
          onChange={({ sourceLang: s, targetLang: t }) => {
            setSourceLang(s);
            setTargetLang(t);
          }}
        />

        <IdleRecordButton
          onStart={handleStart}
          disabled={recorder.phase === "starting"}
        />

        <RecentSessionsPreview />
      </div>

      <PositioningTips />
    </div>
  );
}
