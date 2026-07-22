"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAudioPipeline,
  MicPermissionError,
  MicUnavailableError,
  type AudioPipeline,
} from "@/lib/audio-processor";
import { useWakeLock } from "./use-wake-lock";

export type RecorderPhase =
  | "idle"
  | "starting"
  // Pipeline open and feeding the worklet, but the user hasn't tapped Record
  // yet. The Deepgram WS opens during this phase so the user's first words
  // don't race the handshake; pcmNode frames are gated off until phase
  // flips to "recording".
  | "prewarmed"
  | "recording"
  | "paused"
  | "error";

export interface UseRecorderReturn {
  phase: RecorderPhase;
  error: string | null;
  permissionDenied: boolean;
  unavailable: boolean;
  /** OS suspended the context mid-recording; show a "tap to resume" prompt. */
  interrupted: boolean;
  analyser: AnalyserNode | null;
  pcmNode: AudioWorkletNode | null;
  /**
   * Opens the audio pipeline silently — the WebSocket can warm up before
   * the user taps Record. Safe to call when mic permission is already
   * granted; rejects (silently) on permission prompts so we never trigger
   * an unsolicited browser prompt.
   */
  prewarm: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Resume after an OS interruption without leaving the recording phase. */
  recover: () => void;
  stop: () => Promise<void>;
}

export function useRecorder(): UseRecorderReturn {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [pcmNode, setPcmNode] = useState<AudioWorkletNode | null>(null);
  // True when the AudioContext was suspended mid-recording by the OS (an
  // incoming call, Siri, another app grabbing audio) WITHOUT a visibility
  // change. The worklet stops emitting PCM while this is true, so the UI must
  // tell the user to resume rather than silently losing the rest of the lecture.
  const [interrupted, setInterrupted] = useState(false);
  const pipelineRef = useRef<AudioPipeline | null>(null);
  // Bumped by stop()/unmount to invalidate an in-flight openPipeline() so a
  // pipeline that finishes opening after the user left is torn down, not
  // adopted (else the mic stays hot + the AudioContext leaks).
  const openSeqRef = useRef(0);

  // phase mirror so the imperative callbacks below don't carry stale closures.
  const phaseRef = useRef<RecorderPhase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Hold a screen wake lock for the entire active session — including pauses,
  // since the user is still in the lecture and reading the transcript. Not
  // held during prewarm: the user hasn't started yet.
  useWakeLock(phase === "recording" || phase === "paused");

  const openPipeline = useCallback(async (): Promise<boolean> => {
    if (pipelineRef.current) return true;
    const seq = openSeqRef.current;
    try {
      const pipeline = await createAudioPipeline();
      // Cancelled during the await (stop()/unmount bumped the token) or another
      // open already won the race — do NOT adopt this pipeline; tear it down so
      // the mic track + AudioContext are released instead of leaking hot.
      if (seq !== openSeqRef.current || pipelineRef.current) {
        await pipeline.teardown().catch(() => {});
        return false;
      }
      pipelineRef.current = pipeline;
      setAnalyser(pipeline.analyser);
      setPcmNode(pipeline.pcmNode);
      // Watch for OS-driven suspension that DOESN'T fire visibilitychange (a
      // notification sound, another tab/app taking audio focus). The
      // visibilitychange handler below covers app-switch; this covers the rest.
      pipeline.audioContext.addEventListener("statechange", () => {
        const ctx = pipelineRef.current?.audioContext;
        if (!ctx || ctx !== pipeline.audioContext) return;
        const ph = phaseRef.current;
        if (ctx.state === "running") {
          setInterrupted(false);
        } else if (ph === "recording") {
          // Best-effort auto-resume; if the platform requires a gesture it
          // won't take, so also surface `interrupted` for the "tap to resume"
          // banner. Cleared above once the context is running again.
          void ctx.resume().catch(() => {});
          setInterrupted(true);
        }
      });
      return true;
    } catch (e) {
      // Silently ignore an error on an open we already cancelled.
      if (seq !== openSeqRef.current) return false;
      if (e instanceof MicPermissionError) {
        setPermissionDenied(true);
        setError(e.message);
      } else if (e instanceof MicUnavailableError) {
        setUnavailable(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setPhase("error");
      return false;
    }
  }, []);

  const prewarm = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    setPhase("starting");
    setError(null);
    setPermissionDenied(false);
    setUnavailable(false);
    if (await openPipeline()) {
      // Late race: if the user tapped Record while we were opening, phase
      // will already have been set to "recording" — don't clobber it.
      setPhase((p) => (p === "starting" ? "prewarmed" : p));
    }
  }, [openPipeline]);

  const start = useCallback(async () => {
    const p = phaseRef.current;
    if (p === "recording" || p === "paused") return;
    // The Record tap is a user gesture — the ONE moment iOS will resume a
    // context that prewarm opened while suspended. A plain phase flip alone
    // (the branches below) leaves it suspended, so the worklet never runs and
    // the entire session captures silence ("Listening…" forever). Resume
    // synchronously here, inside the gesture, before returning.
    const warmCtx = pipelineRef.current?.audioContext;
    if (warmCtx && warmCtx.state !== "running")
      void warmCtx.resume().catch(() => {});
    if (p === "prewarmed") {
      setPhase("recording");
      return;
    }
    if (p === "starting") {
      // A prewarm is in flight. Mark intent so it transitions straight to
      // recording when the pipeline is ready.
      setPhase("recording");
      return;
    }
    setPhase("starting");
    setError(null);
    setPermissionDenied(false);
    setUnavailable(false);
    if (await openPipeline()) {
      setPhase("recording");
    }
  }, [openPipeline]);

  const pause = useCallback(() => {
    setPhase((p) => (p === "recording" ? "paused" : p));
  }, []);

  const resume = useCallback(() => {
    // Also resume the AudioContext: iOS suspends it on calls/Siri/app-switch
    // and a plain phase flip wouldn't restart the worklet. This runs inside the
    // user's tap (a gesture), which iOS requires to resume an interrupted ctx.
    const ctx = pipelineRef.current?.audioContext;
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    setInterrupted(false);
    setPhase((p) => (p === "paused" ? "recording" : p));
  }, []);

  // Recover from an OS interruption while STAYING in the recording phase (the
  // "tap to resume" banner). Runs inside the user's tap so iOS actually
  // restarts the hardware; no phase change (we never left "recording").
  const recover = useCallback(() => {
    const ctx = pipelineRef.current?.audioContext;
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    setInterrupted(false);
  }, []);

  const stop = useCallback(async () => {
    openSeqRef.current++; // invalidate any in-flight open so it self-tears-down
    const p = pipelineRef.current;
    pipelineRef.current = null;
    setAnalyser(null);
    setPcmNode(null);
    setInterrupted(false);
    setPhase("idle");
    if (p) {
      try {
        await p.teardown();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      // Intentionally bump the counter + read the pipeline ref AT unmount time
      // to cancel any in-flight open and tear down the live pipeline — reading
      // "current" here is the whole point, not a stale-node mistake.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      openSeqRef.current++;
      const p = pipelineRef.current;
      pipelineRef.current = null;
      if (p) {
        p.teardown().catch(() => {
          /* ignore on unmount */
        });
      }
    };
  }, []);

  // Re-resume a suspended/interrupted AudioContext when the user returns to the
  // app while recording. On iOS an incoming call, Siri, Control Center, a
  // notification, or switching apps suspends the context; once suspended the
  // worklet stops emitting PCM frames while the Deepgram WS stays open (KeepAlive)
  // and the UI still shows "Recording" — silent transcript loss for the rest of
  // the session. The wake lock prevents screen-sleep but NOT these interruptions.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ph = phaseRef.current;
      if (ph !== "recording" && ph !== "paused") return;
      const ctx = pipelineRef.current?.audioContext;
      if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return {
    phase,
    error,
    permissionDenied,
    unavailable,
    interrupted,
    analyser,
    pcmNode,
    prewarm,
    start,
    pause,
    resume,
    recover,
    stop,
  };
}
