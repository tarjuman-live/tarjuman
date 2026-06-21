"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { COLORS, SEGMENT_FLUSH_INTERVAL_MS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { LanguageSelector } from "@/components/recording/language-selector";
import { IdleRecordButton } from "@/components/recording/record-button";
import { RecentSessionsPreview } from "@/components/recording/recent-sessions-preview";
import {
  RecordingShell,
  type TranscriptLayout,
} from "@/components/recording/recording-shell";
import { MicErrorState } from "@/components/recording/mic-error-state";
import { PositioningTips } from "@/components/recording/positioning-tips";
import { AccountMenu } from "@/components/auth/account-menu";
import { useNavVisibility } from "@/components/layout/nav-visibility";
import { haptics } from "@/lib/haptics";
import {
  CompletedView,
  type CompletedSession,
} from "@/components/session/completed-view";
import { useRecorder } from "@/hooks/use-recorder";
import { useDeepgram } from "@/hooks/use-deepgram";
import { useTranslator } from "@/hooks/use-translator";
import { useSessionTimer } from "@/hooks/use-session-timer";

// localStorage key holding an in-progress recording's transcript, so an
// abnormal exit (tab close, mobile tab-discard, pause-then-kill) doesn't lose
// the un-flushed tail or strand the session at status="recording". Written as
// the recording proceeds + on pagehide/visibilitychange; replayed on next mount
// (flushed to Convex + the session completed), then cleared.
const PENDING_KEY = "tarjuman:pending-session";

type StoredSegment = {
  id: string;
  sourceText: string;
  translatedText: string;
  timestamp: number;
  mergedFromIds?: string[];
  combinedSourceText?: string;
  combinedTranslatedText?: string;
};

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

  // Per-user preferences (default languages + TTS), backed by Convex so they
  // follow the user across devices and into the planned native apps.
  const prefs = useQuery(api.preferences.get);
  const updatePrefs = useMutation(api.preferences.update);

  // Hydrate the language pair from saved defaults once, without clobbering a
  // change the user makes during this visit.
  const hydratedLangs = useRef(false);
  useEffect(() => {
    if (hydratedLangs.current || prefs === undefined) return;
    hydratedLangs.current = true;
    if (prefs?.defaultSourceLanguage) setSourceLang(prefs.defaultSourceLanguage);
    if (prefs?.defaultTargetLanguage) setTargetLang(prefs.defaultTargetLanguage);
  }, [prefs]);

  // Main-speaker filter — same Convex-backed pattern as TTS, lifted here from
  // the recording shell so its state survives across recordings and devices.
  const [mainSpeakerOnly, setMainSpeakerOnly] = useState(false);
  const hydratedMain = useRef(false);
  useEffect(() => {
    if (hydratedMain.current || prefs === undefined) return;
    hydratedMain.current = true;
    if (typeof prefs?.mainSpeakerOnly === "boolean") {
      setMainSpeakerOnly(prefs.mainSpeakerOnly);
    } else if (typeof window !== "undefined") {
      const legacy = localStorage.getItem("livetranscribe:main-speaker-only");
      if (legacy !== null) {
        const val = legacy === "1";
        setMainSpeakerOnly(val);
        void updatePrefs({ mainSpeakerOnly: val });
      }
    }
  }, [prefs, updatePrefs]);
  const toggleMainSpeaker = () => {
    setMainSpeakerOnly((cur) => {
      const next = !cur;
      void updatePrefs({ mainSpeakerOnly: next });
      return next;
    });
  };

  // Transcript layout: stacked cards ("paired") vs split language panes
  // ("split"). An additive "extra look" — local-only pref via localStorage.
  const [transcriptLayout, setTranscriptLayout] =
    useState<TranscriptLayout>("paired");
  useEffect(() => {
    try {
      const v = localStorage.getItem("tarjuman:transcript-layout");
      if (v === "split" || v === "paired") setTranscriptLayout(v);
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const setLayout = (l: TranscriptLayout) => {
    setTranscriptLayout(l);
    try {
      localStorage.setItem("tarjuman:transcript-layout", l);
    } catch {
      /* localStorage unavailable */
    }
  };

  const recorder = useRecorder();
  const isActive =
    recorder.phase === "recording" || recorder.phase === "paused";
  const isPrewarmed = recorder.phase === "prewarmed";

  // Hide the floating bottom nav while recording/paused AND on the
  // "Session complete" view (completedSession set), so the recording and
  // results screens aren't crowded. NOT during prewarm/starting — those are
  // idle-screen states (the mic warms up before the user taps Record). The nav
  // returns on the plain idle screen and after "New recording" clears the
  // completed session.
  const { setHidden: setNavHidden } = useNavVisibility();
  const hideNav = isActive || completedSession !== null;
  useEffect(() => {
    setNavHidden(hideNav);
  }, [hideNav, setNavHidden]);
  useEffect(() => () => setNavHidden(false), [setNavHidden]);

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

  // Mirror current transcript + active state into refs so the exit handlers
  // (registered once) and the flush tick can serialize the latest state into
  // localStorage without re-binding.
  const transcriptRef = useRef({
    segments: deepgram.segments,
    translations: translator.translations,
    merges: translator.merges,
    filteredIds: translator.filteredIds,
  });
  useEffect(() => {
    transcriptRef.current = {
      segments: deepgram.segments,
      translations: translator.translations,
      merges: translator.merges,
      filteredIds: translator.filteredIds,
    };
  }, [
    deepgram.segments,
    translator.translations,
    translator.merges,
    translator.filteredIds,
  ]);
  const activeRef = useRef(isActive);
  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  // Synchronously snapshot the in-progress transcript to localStorage. Survives
  // a hard tab kill (unlike an async Convex mutation), so the un-flushed tail is
  // recoverable on next mount. No-op when no session is in progress.
  const writePendingMirror = () => {
    if (typeof window === "undefined") return;
    const sessionId = sessionIdRef.current;
    if (!sessionId || !activeRef.current) return;
    const { source, target } = langsRef.current;
    const sameLang = source === target;
    const { segments, translations, merges, filteredIds } =
      transcriptRef.current;
    const stored: StoredSegment[] = segments
      .filter((s) => s.isFinal && !filteredIds.has(s.id))
      .map((seg) => {
        const merge = merges[seg.id];
        return {
          id: seg.id,
          sourceText: seg.text,
          translatedText: sameLang ? seg.text : translations[seg.id] ?? "",
          timestamp: seg.timestamp,
          ...(merge
            ? {
                mergedFromIds: merge.fromIds,
                combinedSourceText: merge.combinedSourceText,
                combinedTranslatedText: merge.combinedTranslatedText,
              }
            : {}),
        };
      });
    if (stored.length === 0) return;
    try {
      localStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
          sessionId,
          durationSec: elapsedRef.current,
          segments: stored,
        })
      );
    } catch {
      /* quota exceeded / serialization error — best-effort, ignore */
    }
  };

  const clearPendingMirror = () => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
  };

  const flushSegments = (force = false) => {
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
      // Persist only once the FINAL enriched translation has landed — NOT on a
      // partial streamed delta (which now sets translations[id] mid-stream).
      // completedIds marks "done" (translated, filtered, or finalized).
      if (translator.completedIds.has(seg.id)) return true;
      // On a forced flush (Stop), persist untranslated finals too — better a
      // segment with its Arabic source and a blank translation than the whole
      // segment (often the closing du'a/summary) silently lost because its
      // translation was still in flight when the user tapped Stop. Regular
      // ticks still wait for the translation to land.
      return force;
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
    const id = window.setInterval(() => {
      flushSegments();
      writePendingMirror();
    }, SEGMENT_FLUSH_INTERVAL_MS);
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

  // Recover an orphaned recording from a previous abnormal exit: flush its
  // mirrored transcript to Convex and mark the session complete, then clear the
  // mirror. Gated on `prefs` resolving so the Convex auth handshake is done
  // (the mutations require an authenticated user). Runs at most once.
  const replayedRef = useRef(false);
  useEffect(() => {
    if (replayedRef.current) return;
    if (prefs === undefined) return; // wait for auth to settle
    if (typeof window === "undefined") return;
    replayedRef.current = true;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let pending: {
      sessionId?: string;
      durationSec?: number;
      segments?: StoredSegment[];
    };
    try {
      pending = JSON.parse(raw);
    } catch {
      clearPendingMirror();
      return;
    }
    const pendingId = pending.sessionId;
    if (!pendingId) {
      clearPendingMirror();
      return;
    }
    void (async () => {
      try {
        if (Array.isArray(pending.segments) && pending.segments.length > 0) {
          await addSegments({
            sessionId: pendingId as Id<"sessions">,
            segments: pending.segments,
          });
        }
        await completeSessionM({
          sessionId: pendingId as Id<"sessions">,
          duration: pending.durationSec ?? 0,
        });
      } catch {
        /* session gone / not ours — nothing recoverable */
      } finally {
        clearPendingMirror();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  // Snapshot the transcript to localStorage when the tab is hidden or unloaded —
  // the moment a mobile OS may discard it. The sync localStorage write is the
  // reliable backstop (an async Convex mutation can't finish during unload);
  // next mount replays it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageHide = () => writePendingMirror();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") writePendingMirror();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // writePendingMirror reads only refs — register once.
  }, []);

  const handleStart = () => {
    setCompletedSession(null);
    haptics.start();
    void recorder.start();
  };

  const handlePause = () => {
    flushSegments();
    writePendingMirror();
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
      filteredIds: translator.filteredIds,
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
        // queue ensures addSegments applies before completeSession. Force it:
        // persist every remaining final segment (even ones whose translation
        // hadn't resolved yet) so the closing content is never lost.
        flushSegments(true);
        void completeSessionM({ sessionId, duration: finalDuration });
      }
      const snapshot: CompletedSession = {
        _id: sessionId,
        segments: captured.segments,
        translations: captured.translations,
        merges: captured.merges,
        filteredIds: captured.filteredIds,
        durationSec: finalDuration,
        sourceLang: captured.sourceLang,
        targetLang: captured.targetLang,
      };
      setCompletedSession(snapshot);
      // Cleanly stopped — drop the abnormal-exit mirror so it isn't replayed.
      clearPendingMirror();
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
        errors={translator.errors}
        pending={translator.pending}
        onRetry={translator.retry}
        transcriptLayout={transcriptLayout}
        onSetLayout={setLayout}
        mainSpeakerOnly={mainSpeakerOnly}
        onMainSpeakerToggle={toggleMainSpeaker}
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
              Tarjuman
            </span>
          </div>
          <AccountMenu />
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
            Tarjuman
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
