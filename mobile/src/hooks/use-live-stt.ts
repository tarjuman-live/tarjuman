import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { startSpeechmaticsSession } from "@shared/stt/speechmatics-session";
import type { ConnectionState, LiveSegment } from "@shared-types";
import { apiUrl } from "~/lib/config";
import { makeId } from "~/lib/ids";
import type { NativeRecorder } from "./use-native-recorder";

interface Options {
  recorder: NativeRecorder;
  sourceLanguage: string;
  enabled: boolean;
  paused: boolean;
  mainSpeakerOnly: boolean;
}

/**
 * Native twin of the web's use-speechmatics.ts. Everything that decides what
 * the transcript says — StartRecognition config, sentence accumulation,
 * confidence floor, off-language gate, speaker lock, reconnect, timestamps —
 * is the shared session core; this hook only feeds it native frames.
 */
export function useLiveStt({
  recorder,
  sourceLanguage,
  enabled,
  paused,
  mainSpeakerOnly,
}: Options) {
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [interimText, setInterimText] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const authToken = useAuthToken();
  const tokenRef = useRef(authToken);
  const pausedRef = useRef(paused);
  const mainSpeakerOnlyRef = useRef(mainSpeakerOnly);
  const sampleRateRef = useRef(recorder.sampleRate);
  useEffect(() => {
    tokenRef.current = authToken;
    pausedRef.current = paused;
    mainSpeakerOnlyRef.current = mainSpeakerOnly;
    sampleRateRef.current = recorder.sampleRate;
  });

  const sessionRef = useRef<ReturnType<typeof startSpeechmaticsSession> | null>(null);

  // Connect only once the first buffer has told us the REAL capture rate —
  // StartRecognition declares it, and a wrong rate garbles everything.
  const ready = enabled && recorder.sampleRate !== null;
  const { subscribe } = recorder;

  useEffect(() => {
    if (!ready) {
      setConnectionState("idle");
      return;
    }
    let live = true;
    const guard =
      <A extends unknown[]>(fn: (...a: A) => void) =>
      (...a: A) => {
        if (live) fn(...a);
      };

    const session = startSpeechmaticsSession({
      sourceLanguage,
      getSampleRate: () => sampleRateRef.current ?? undefined,
      fetchCredentials: () => {
        const token = tokenRef.current;
        return fetch(apiUrl("/api/speechmatics"), {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      },
      isPaused: () => pausedRef.current,
      isMainSpeakerOnly: () => mainSpeakerOnlyRef.current,
      onSegment: guard((seg) => setSegments((prev) => [...prev, seg])),
      onInterim: guard(setInterimText),
      onState: guard(setConnectionState),
      onError: guard(setError),
      onReconnectAttempt: guard(setReconnectAttempt),
      makeId,
      log: __DEV__ ? console.log : undefined,
    });
    sessionRef.current = session;
    const unsubscribe = subscribe((frame) => session.sendFrame(frame));

    return () => {
      unsubscribe();
      // stop() flushes the mid-accumulation sentence; keep delivering it.
      session.stop();
      live = false;
      sessionRef.current = null;
    };
  }, [ready, sourceLanguage, subscribe]);

  const reset = useCallback(() => {
    setSegments([]);
    setInterimText("");
    setError(null);
  }, []);

  return { segments, interimText, connectionState, error, reconnectAttempt, reset };
}
