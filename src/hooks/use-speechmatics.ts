"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { ConnectionState, LiveSegment } from "@/types";
import { startSpeechmaticsSession } from "@/lib/stt/speechmatics-session";

/**
 * Production realtime STT over Speechmatics (RT v2).
 *
 * Deliberately exposes the SAME shape as use-deepgram.ts so the record page can
 * switch engines by swapping one import — see use-stt.ts. Deepgram remains
 * fully wired as the fallback.
 *
 * WHY SPEECHMATICS IS PRIMARY: in side-by-side field tests on Arabic khutbah
 * audio (/dev/stt-compare) it produced whole coherent sentences at ~1.00
 * confidence where nova-3 fragmented into partial segments and dropped clauses.
 * It costs latency — finals land ~1.3-1.5s behind vs ~0.4-0.8s — which is the
 * trade being made deliberately: accurate transcription is the product.
 *
 * PROTOCOL NOTES that differ from Deepgram and matter here:
 *   - Audio sent before RecognitionStarted is DISCARDED, so frames are gated
 *     on the ack rather than the socket being open.
 *   - Finals arrive ONE WORD AT A TIME. They're accumulated into sentences and
 *     flushed on Speechmatics' own `is_eos` marker, because a word-per-segment
 *     transcript would wreck translation quality (each segment is translated
 *     independently — single words have no context to translate against).
 *   - `transcript` lives inside `metadata`, not at the top level.
 *   - Errors arrive as an in-band { message: "Error" } frame with a real reason
 *     BEFORE the socket closes.
 *
 * LIMITS (docs.speechmatics.com/speech-to-text/realtime/limits):
 *   48h max session · 1h idle tolerance with no audio · 3min with no ping/pong.
 * A 3h dars fits comfortably, and the 1h idle window means a pause needs no
 * keepalive — frames are simply dropped, as with Deepgram.
 */

const DBG = process.env.NODE_ENV !== "production";
const dbg: typeof console.log = DBG ? console.log.bind(console) : () => {};

export interface UseSpeechmaticsOptions {
  pcmNode: AudioWorkletNode | null;
  sourceLanguage: string;
  enabled: boolean;
  paused: boolean;
  mainSpeakerOnly?: boolean;
}

export interface UseSpeechmaticsReturn {
  segments: LiveSegment[];
  interimText: string;
  connectionState: ConnectionState;
  error: string | null;
  reconnectAttempt: number;
  resetTranscript: () => void;
}

export function useSpeechmatics({
  pcmNode,
  sourceLanguage,
  enabled,
  paused,
  mainSpeakerOnly = false,
}: UseSpeechmaticsOptions): UseSpeechmaticsReturn {
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [interimText, setInterimText] = useState("");
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const authToken = useAuthToken();
  const authTokenRef = useRef<string | null | undefined>(authToken);
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const generationRef = useRef(0);

  // Read by the PCM frame handler so pause/resume doesn't rebuild the socket.
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const mainSpeakerOnlyRef = useRef(mainSpeakerOnly);
  useEffect(() => {
    mainSpeakerOnlyRef.current = mainSpeakerOnly;
  }, [mainSpeakerOnly]);

  const resetTranscript = useCallback(() => {
    setSegments([]);
    setInterimText("");
  }, []);

  useEffect(() => {
    if (!enabled || !pcmNode) {
      setConnectionState("idle");
      setReconnectAttempt(0);
      return;
    }

    // Stale-closure guard for React StrictMode's dev double-mount: callbacks
    // from an older generation no-op instead of writing into this one's state.
    const myGeneration = ++generationRef.current;
    const live = <A extends unknown[]>(fn: (...a: A) => void) =>
      (...a: A) => {
        if (generationRef.current === myGeneration) fn(...a);
      };

    // Protocol, filtering (confidence floor, script gate, speaker lock),
    // reconnect and timestamps all live in the shared core so the native app
    // runs the identical policy. This hook only wires the AudioWorklet in.
    const session = startSpeechmaticsSession({
      sourceLanguage,
      getSampleRate: () => pcmNode.context?.sampleRate,
      fetchCredentials: () => {
        const token = authTokenRef.current;
        return fetch("/api/speechmatics", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      },
      isPaused: () => pausedRef.current,
      isMainSpeakerOnly: () => mainSpeakerOnlyRef.current,
      onSegment: live((seg) => setSegments((prev) => [...prev, seg])),
      onInterim: live(setInterimText),
      onState: live(setConnectionState),
      onError: live(setError),
      onReconnectAttempt: live(setReconnectAttempt),
      log: dbg,
    });

    // addEventListener (not onmessage) needs an explicit start() to begin
    // delivery; onmessage's setter used to do that implicitly.
    const port = pcmNode.port;
    const onFrame = (e: MessageEvent) => session.sendFrame(e.data as ArrayBuffer);
    port.addEventListener("message", onFrame);
    port.start();

    return () => {
      port.removeEventListener("message", onFrame);
      // stop() flushes the mid-accumulation sentence so the last words of a
      // recording are not silently lost on stop.
      session.stop();
    };
  }, [enabled, pcmNode, sourceLanguage]);

  return {
    segments,
    interimText,
    // Deliberately NOT remapped to "paused" when paused. use-deepgram never
    // emits that state either — the recording UI derives pause from its own
    // `paused` prop and tests `connectionState === "connected" && !paused`.
    // Emitting "paused" here would silently falsify that check.
    connectionState,
    error,
    reconnectAttempt,
    resetTranscript,
  };
}
