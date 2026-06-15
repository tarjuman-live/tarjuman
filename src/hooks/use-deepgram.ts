"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { ConnectionState, LiveSegment } from "@/types";
import {
  DEEPGRAM_KEEPALIVE_INTERVAL_MS,
  RECONNECT_BACKOFF,
} from "@/lib/constants";
import { RollingAudioBuffer } from "@/lib/audio-buffer";

export interface UseDeepgramOptions {
  /**
   * Source of Int16 PCM frames. Built by `createAudioPipeline` — its
   * `port.onmessage` fires every ~40ms with an ArrayBuffer ready to
   * forward to Deepgram as a binary WebSocket frame.
   */
  pcmNode: AudioWorkletNode | null;
  sourceLanguage: string;
  /** Tear down when false. Drives the connection lifecycle effect. */
  enabled: boolean;
  /**
   * When true (and enabled), drops outbound PCM frames + sends KeepAlive
   * pings so the WS doesn't time out. The connection stays open across
   * pauses, and the audio graph keeps running (frames are discarded on
   * the send side rather than gating the worklet itself).
   */
  paused: boolean;
}

export interface UseDeepgramReturn {
  segments: LiveSegment[];
  interimText: string;
  connectionState: ConnectionState;
  error: string | null;
  reconnectAttempt: number;
  resetTranscript: () => void;
  /**
   * Rolling buffer of recent PCM audio (mirrors what's sent to Deepgram).
   * The translator slices the matching window per segment and sends it to
   * OpenAI Whisper for a parallel transcription, then Claude reconciles.
   */
  audioBuffer: RollingAudioBuffer;
}

interface DeepgramWord {
  word: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: number;
  speaker_confidence?: number;
}

interface DeepgramResultMessage {
  type: "Results";
  is_final: boolean;
  speech_final?: boolean;
  start: number;
  duration: number;
  channel: {
    alternatives: {
      transcript: string;
      confidence?: number;
      words?: DeepgramWord[];
    }[];
    // Present when `detect_language=true` is set on the connection. Used to
    // drop segments where the spoken language doesn't match the source the
    // user picked (e.g., English bleed in an Arabic-source session).
    detected_language?: string;
    language_confidence?: number;
  };
}

type DeepgramMessage =
  | DeepgramResultMessage
  | { type: "Metadata" }
  | { type: "UtteranceEnd" }
  | { type: "SpeechStarted" };

/**
 * Drop a final segment if Deepgram's confidence falls below this threshold.
 * Native-language khutbah audio through PA + room reverb typically scores
 * 0.7–0.95 on real speech. Off-language audio (e.g., English side-conversation
 * in an Arabic session) typically lands in 0.2–0.5. 0.55 is the floor that
 * keeps the speaker's quieter moments while rejecting off-language bleed and
 * misheard ambient noise.
 */
const FINAL_CONFIDENCE_THRESHOLD = 0.55;

/**
 * Don't paint interim text below this confidence. Interims are partial
 * hypotheses so they score lower than finals — this floor is deliberately
 * lenient. It exists so off-language speech (which Deepgram, forced to the
 * session language, transcribes as low-confidence transliterated noise)
 * doesn't continuously flash garbage in the live view while every final
 * gets dropped by the filters downstream. Real source-language speech
 * crosses 0.4 within the first word or two.
 */
const INTERIM_CONFIDENCE_THRESHOLD = 0.4;

/** Lock policy: don't lock until the session has been active this long. */
const SPEAKER_LOCK_WARMUP_MS = 15_000;
/** Lock policy: minimum speech duration (seconds) before any speaker can be locked. */
const SPEAKER_LOCK_MIN_DURATION_S = 5;
/** Off-language drop: only drop if the language-detection confidence exceeds this. */
const LANGUAGE_MISMATCH_DROP_THRESHOLD = 0.7;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Opens a Deepgram live-transcription WebSocket and forwards Int16 PCM
 * frames (40ms each, 16kHz mono, Linear16) emitted by an AudioWorkletNode.
 * Exposes both interim and finalized segments.
 *
 * Reconnects on abnormal close with exponential backoff
 * ([1s, 2s, 4s, 8s, 16s, 30s]). On auth-style failures (1008, 4001/8/9)
 * or handshake rejection (1006 before any successful open), the hook
 * surfaces the error and stops retrying rather than thrashing.
 *
 * On `paused`: outbound frames are dropped at the WebSocket boundary
 * (a `pausedRef` guards the send) and a KeepAlive message is sent every
 * 5s so the WS doesn't time out. Deepgram drops idle connections after
 * ~10s; the connection itself stays open across pause/resume cycles.
 *
 * All connection-scoped state lives in the effect closure — NOT in
 * component-lifetime refs — so React StrictMode's dev double-mount can
 * never cross wires between the fake and real connection attempts.
 */
export function useDeepgram({
  pcmNode,
  sourceLanguage,
  enabled,
  paused,
}: UseDeepgramOptions): UseDeepgramReturn {
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [interimText, setInterimText] = useState("");
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // Convex Auth token, attached as Bearer to the /api/deepgram credential
  // fetch so the route can authorize + rate-limit the user. Kept in a ref so a
  // token refresh doesn't tear down and rebuild the live WebSocket.
  const authToken = useAuthToken();
  const authTokenRef = useRef<string | null | undefined>(authToken);
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  // Hide stale StrictMode closures behind a stable "generation" — each
  // effect invocation gets a unique id; handlers ignore events from older
  // generations.
  const generationRef = useRef(0);

  // Exposed by the connection effect so the pause/resume sibling effect can
  // send KeepAlive pings without rebuilding the WS.
  const liveControlsRef = useRef<{ ws: WebSocket | null }>({ ws: null });

  // Read by the worklet's port.onmessage handler to gate outbound frames.
  // A ref (not state) so the handler always sees the latest paused value
  // without re-establishing the WS each time it flips.
  const pausedRef = useRef(false);

  // Rolling PCM buffer mirroring what's sent to Deepgram. Lives across
  // WS reconnects; reset on enabled=false or unmount. The translator
  // slices this per segment for parallel Whisper transcription.
  // Lazy useState (not a ref): the instance is returned from the hook, and
  // reading a ref during render is forbidden. The setter is never used —
  // the instance is mutated in place and lives for the hook's lifetime.
  const [audioBuffer] = useState(() => new RollingAudioBuffer());

  // Session-wide speaker lock. Once locked, segments where the dominant
  // speaker isn't the locked speaker are dropped (per user policy: "ignore
  // side conversations"). Refs survive WS reconnects within the same session
  // and are reset only when the hook teardown fires (enabled=false / unmount).
  const lockedSpeakerRef = useRef<number | null>(null);
  const speakerDurationsRef = useRef<Map<number, number>>(new Map());
  const sessionStartRef = useRef<number | null>(null);

  const resetTranscript = useCallback(() => {
    setSegments([]);
    setInterimText("");
  }, []);

  useEffect(() => {
    if (!enabled || !pcmNode) {
      setConnectionState("idle");
      setReconnectAttempt(0);
      // Reset speaker-lock state at the end of a session so the next session
      // starts fresh. Keeping it across stop/start would carry a stale lock
      // from a previous speaker into a new recording.
      lockedSpeakerRef.current = null;
      speakerDurationsRef.current = new Map();
      sessionStartRef.current = null;
      audioBuffer.reset();
      return;
    }

    const myGeneration = ++generationRef.current;
    const isLive = () => generationRef.current === myGeneration;
    sessionStartRef.current = Date.now();
    audioBuffer.reset();

    // Closure-local state. NOT refs. This entire block is torn down on
    // the next mount, and nothing leaks into the re-mount.
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let hasEverOpened = false;

    setReconnectAttempt(0);
    setError(null);

    const tearDown = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // Detach the PCM frame handler. The worklet keeps emitting frames as
      // long as the audio context is alive; without a handler they are
      // silently discarded by the browser. The audio-processor teardown
      // closes the port and disconnects the node when the user stops.
      pcmNode.port.onmessage = null;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "CloseStream" }));
          }
        } catch {
          /* ignore */
        }
        try {
          ws.close(1000);
        } catch {
          /* ignore */
        }
      }
      ws = null;
      liveControlsRef.current = { ws: null };
    };

    const scheduleReconnect = () => {
      if (cancelled || !isLive()) return;
      if (attempt >= RECONNECT_BACKOFF.length) {
        setConnectionState("error");
        setError(
          (prev) =>
            prev ??
            `Could not reach Deepgram after ${RECONNECT_BACKOFF.length} attempts. Check your network connection.`
        );
        return;
      }
      const delay = RECONNECT_BACKOFF[attempt];
      attempt += 1;
      setReconnectAttempt(attempt);
      setConnectionState("reconnecting");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!cancelled && isLive()) void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled || !isLive()) return;
      setConnectionState(attempt === 0 ? "connecting" : "reconnecting");

      // Step 1: credentials.
      let creds: { key: string; url: string };
      try {
        const token = authTokenRef.current;
        const res = await fetch(
          `/api/deepgram?language=${encodeURIComponent(sourceLanguage)}`,
          {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }
        );
        if (cancelled || !isLive()) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          const msg =
            body?.error ?? `Failed to fetch Deepgram token (${res.status})`;
          // 500 missing-config and 502 Deepgram-rejected responses are
          // unrecoverable — surface them once and stop retrying.
          const unrecoverable =
            (res.status === 500 && /API_KEY.*not configured/i.test(msg)) ||
            res.status === 502;
          if (unrecoverable) {
            setError(msg);
            setConnectionState("error");
            return;
          }
          throw new Error(msg);
        }
        creds = await res.json();
        if (!creds.key || !creds.url) {
          throw new Error("Deepgram credentials missing in server response");
        }
      } catch (e) {
        if (cancelled || !isLive()) return;
        setError(e instanceof Error ? e.message : String(e));
        scheduleReconnect();
        return;
      }

      if (cancelled || !isLive()) return;

      // Step 2: open the WebSocket. Two server-side modes:
      //   - Dev: creds.url is ws(s)://<host>/api/deepgram-ws and creds.key is
      //     a session token already embedded in the URL. No subprotocol — the
      //     proxy (server.js) authenticates with Deepgram itself.
      //   - Prod: creds.url is wss://api.deepgram.com/... and creds.key is a
      //     short-lived Deepgram temp key. Pass it as the `token` subprotocol
      //     so the browser authenticates directly with Deepgram.
      const isDirectDeepgram = creds.url.startsWith("wss://api.deepgram.com");
      console.log("[deepgram] opening WS:", creds.url, {
        direct: isDirectDeepgram,
      });
      try {
        ws = isDirectDeepgram
          ? new WebSocket(creds.url, ["token", creds.key])
          : new WebSocket(creds.url);
      } catch (e) {
        if (cancelled || !isLive()) return;
        setError(e instanceof Error ? e.message : String(e));
        scheduleReconnect();
        return;
      }

      const currentWs = ws;
      liveControlsRef.current.ws = currentWs;

      currentWs.onopen = () => {
        console.log("[deepgram] ws onopen — authenticated successfully", {
          subprotocolUsed: currentWs.protocol || "(none echoed back)",
        });
        if (cancelled || !isLive() || ws !== currentWs) {
          try {
            currentWs.close(1000);
          } catch {
            /* ignore */
          }
          return;
        }
        setConnectionState("connected");
        attempt = 0;
        hasEverOpened = true;
        setReconnectAttempt(0);

        // Step 3: subscribe to the PCM worklet's frame stream. Each message
        // is an Int16 ArrayBuffer (40ms @ 16kHz, mono) ready to forward as
        // a binary WebSocket frame.
        pcmNode.port.onmessage = (event) => {
          if (cancelled || !isLive() || ws !== currentWs) return;
          if (pausedRef.current) return;
          if (currentWs.readyState !== WebSocket.OPEN) return;
          const data = event.data as ArrayBuffer;
          if (!data || data.byteLength === 0) return;
          currentWs.send(data);
          // Mirror the same frame into the rolling audio buffer so the
          // translator can later slice it for parallel Whisper transcription.
          audioBuffer.push(new Int16Array(data));
        };
      };

      currentWs.onmessage = (event) => {
        if (cancelled || !isLive() || ws !== currentWs) return;
        if (typeof event.data !== "string") return;
        let msg: DeepgramMessage;
        try {
          msg = JSON.parse(event.data) as DeepgramMessage;
        } catch {
          return;
        }
        if (msg.type !== "Results") return;

        const transcript = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (!transcript.trim()) return;

        if (msg.is_final) {
          const alt = msg.channel.alternatives[0];
          const confidence = alt?.confidence ?? 0;
          if (confidence < FINAL_CONFIDENCE_THRESHOLD) {
            console.log(
              `[deepgram] dropped low-confidence final (${confidence.toFixed(
                2
              )}): "${transcript.slice(0, 60)}"`
            );
            setInterimText("");
            return;
          }
          // Off-language drop — currently INERT. detected_language is only
          // present with detect_language=true, which the /api/deepgram route
          // no longer sends (nova-3 rejects it alongside a fixed language=,
          // and language=multi has no Arabic support as of mid-2026). Kept
          // as a free defense in case the params ever change. The live
          // off-language filtering happens downstream: Whisper language-ID
          // drop in use-translator.ts + script/LLM filters in /api/translate.
          const detectedLang = msg.channel.detected_language;
          const langConf = msg.channel.language_confidence ?? 0;
          if (
            detectedLang &&
            langConf >= LANGUAGE_MISMATCH_DROP_THRESHOLD &&
            !detectedLang.toLowerCase().startsWith(sourceLanguage.toLowerCase())
          ) {
            console.log(
              `[deepgram] dropped off-language segment (detected=${detectedLang} @ ${langConf.toFixed(
                2
              )}, source=${sourceLanguage}): "${transcript.slice(0, 60)}"`
            );
            setInterimText("");
            return;
          }
          // Pick the dominant speaker for this segment by total word duration.
          // Falls back to the first word's speaker, then undefined if no
          // speaker info (diarization disabled or single-speaker session).
          const words = alt?.words ?? [];
          let speaker: number | undefined;
          if (words.length > 0) {
            const totals = new Map<number, number>();
            for (const w of words) {
              if (typeof w.speaker !== "number") continue;
              const dur = (w.end ?? 0) - (w.start ?? 0);
              totals.set(w.speaker, (totals.get(w.speaker) ?? 0) + dur);
            }
            if (totals.size > 0) {
              let maxDur = -1;
              for (const [s, d] of totals) {
                if (d > maxDur) {
                  maxDur = d;
                  speaker = s;
                }
              }
            } else if (typeof words[0].speaker === "number") {
              speaker = words[0].speaker;
            }
          }

          // Speaker lock — accumulate per-speaker speech duration across the
          // session; once we have enough signal, lock onto the speaker with
          // the most total speech, and drop subsequent segments where that
          // speaker isn't dominant. This implements "ignore side conversations
          // and sounds" — the loudest/main speaker stays, others are filtered.
          if (words.length > 0) {
            for (const w of words) {
              if (typeof w.speaker !== "number") continue;
              const dur = (w.end ?? 0) - (w.start ?? 0);
              if (dur <= 0) continue;
              speakerDurationsRef.current.set(
                w.speaker,
                (speakerDurationsRef.current.get(w.speaker) ?? 0) + dur
              );
            }
          }
          if (lockedSpeakerRef.current === null) {
            // Lock-fire conditions: session has been active long enough AND
            // any speaker has accumulated enough speech. The warmup keeps the
            // lock from snapping onto a brief opening cough or unrelated voice.
            const sessionAgeMs = sessionStartRef.current
              ? Date.now() - sessionStartRef.current
              : 0;
            if (sessionAgeMs >= SPEAKER_LOCK_WARMUP_MS) {
              let bestSpeaker: number | null = null;
              let bestDur = -1;
              for (const [s, d] of speakerDurationsRef.current) {
                if (d > bestDur) {
                  bestDur = d;
                  bestSpeaker = s;
                }
              }
              if (bestSpeaker !== null && bestDur >= SPEAKER_LOCK_MIN_DURATION_S) {
                lockedSpeakerRef.current = bestSpeaker;
                console.log(
                  `[deepgram] locked to speaker ${bestSpeaker} after ${(
                    sessionAgeMs / 1000
                  ).toFixed(1)}s (${bestDur.toFixed(1)}s of speech)`
                );
              }
            }
          } else if (speaker !== undefined && speaker !== lockedSpeakerRef.current) {
            // Locked, and this segment's dominant speaker isn't the locked
            // one. Drop it — it's a side conversation.
            console.log(
              `[deepgram] dropped side-speaker segment (speaker=${speaker}, locked=${lockedSpeakerRef.current}): "${transcript.slice(
                0,
                60
              )}"`
            );
            setInterimText("");
            return;
          }
          setSegments((prev) => [
            ...prev,
            {
              id: makeId(),
              text: transcript,
              isFinal: true,
              timestamp:
                typeof msg.start === "number"
                  ? Math.max(0, msg.start)
                  : prev[prev.length - 1]?.timestamp ?? 0,
              durationSec:
                typeof msg.duration === "number" ? msg.duration : undefined,
              speaker,
              confidence,
            },
          ]);
          setInterimText("");
        } else {
          // Interim gating: skip (don't clear) updates below the confidence
          // floor — a kept higher-confidence interim beats flashing noise.
          const interimConfidence =
            msg.channel?.alternatives?.[0]?.confidence ?? 1;
          if (interimConfidence >= INTERIM_CONFIDENCE_THRESHOLD) {
            setInterimText(transcript);
          }
        }
      };

      currentWs.onerror = (event) => {
        // The browser hides the actual cause for security reasons; this is
        // a generic Event with no useful detail. The follow-up `onclose`
        // gets the close code which is what we actually act on.
        console.log("[deepgram] ws onerror (details hidden by browser)", event);
      };

      currentWs.onclose = (event) => {
        console.log("[deepgram] ws onclose", {
          code: event.code,
          reason: event.reason || "(empty)",
          wasClean: event.wasClean,
          hasEverOpened,
        });

        if (ws === currentWs) ws = null;
        if (liveControlsRef.current.ws === currentWs) {
          liveControlsRef.current = { ws: null };
        }
        // Stop forwarding PCM frames to a closed socket. The worklet keeps
        // running; the audio-processor teardown will close the port when
        // the user actually stops the recording.
        pcmNode.port.onmessage = null;

        if (cancelled || !isLive()) return;
        if (event.code === 1000) {
          setConnectionState("idle");
          return;
        }

        // 1008 / 401-style closures from our proxy mean the session token
        // expired or was missing — fixable by reconnecting (which fetches a
        // fresh token). 1011 is server error (Deepgram-side).
        const authFailure =
          event.code === 1008 ||
          event.code === 4001 ||
          event.code === 4008 ||
          event.code === 4009;
        const badRequest = event.code === 1002 || event.code === 1003;
        const handshakeRejectionBeforeFirstOpen =
          event.code === 1006 && !hasEverOpened;

        if (handshakeRejectionBeforeFirstOpen) {
          setError(
            isDirectDeepgram
              ? `Could not reach Deepgram (close code ${event.code}). The temp key may have been rejected — verify DEEPGRAM_API_KEY is set in the Vercel project env vars and that the master key has admin/keys:write scope at the Deepgram console.`
              : `Could not reach the local Deepgram proxy (close code ${event.code}). Make sure the dev server was started with \`npm run dev\` (which uses server.js, not bare \`next dev\`). If you see \`> Ready on http://localhost:3000 (with /api/deepgram-ws proxy)\` in the terminal, the proxy is up — in that case the problem is the proxy → Deepgram leg; check the server log for [deepgram-proxy] errors.`
          );
          setConnectionState("error");
          return;
        }
        if (authFailure) {
          setError(
            `Proxy rejected the session (code ${event.code}). The token may have expired between issue and use; reconnect should re-issue.`
          );
          setConnectionState("error");
          return;
        }
        if (badRequest) {
          setError(
            `Deepgram rejected the request (code ${event.code}, reason="${event.reason || "(empty)"}"). Unsupported audio format or parameters.`
          );
          setConnectionState("error");
          return;
        }

        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      cancelled = true;
      tearDown();
    };
  }, [pcmNode, sourceLanguage, enabled, audioBuffer]);

  // Pause/resume effect — does NOT trigger a reconnect. It flips the
  // pausedRef the worklet handler reads, and owns the KeepAlive timer
  // that keeps Deepgram from dropping the idle WS during silence.
  useEffect(() => {
    pausedRef.current = paused;
    if (!enabled || !paused) return;
    const interval = window.setInterval(() => {
      const { ws } = liveControlsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "KeepAlive" }));
        } catch {
          /* ignore */
        }
      }
    }, DEEPGRAM_KEEPALIVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [paused, enabled]);

  return {
    segments,
    interimText,
    connectionState,
    error,
    reconnectAttempt,
    resetTranscript,
    audioBuffer,
  };
}
