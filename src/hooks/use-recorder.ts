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
  stop: () => Promise<void>;
}

export function useRecorder(): UseRecorderReturn {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [pcmNode, setPcmNode] = useState<AudioWorkletNode | null>(null);
  const pipelineRef = useRef<AudioPipeline | null>(null);

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
    try {
      const pipeline = await createAudioPipeline();
      pipelineRef.current = pipeline;
      setAnalyser(pipeline.analyser);
      setPcmNode(pipeline.pcmNode);
      return true;
    } catch (e) {
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
    setPhase((p) => (p === "paused" ? "recording" : p));
  }, []);

  const stop = useCallback(async () => {
    const p = pipelineRef.current;
    pipelineRef.current = null;
    setAnalyser(null);
    setPcmNode(null);
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
    analyser,
    pcmNode,
    prewarm,
    start,
    pause,
    resume,
    stop,
  };
}
