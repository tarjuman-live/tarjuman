"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { ConnectionState, LiveSegment } from "@/types";
import { DEEPGRAM, RECONNECT_BACKOFF } from "@/lib/constants";
import { isOffLanguageScript } from "@/lib/script";
import { createSpeakerLock } from "@/lib/stt/speaker-lock";

// Connection/transcript debug logs — DEV ONLY. In production this is a no-op so
// transcript text is never written to the browser console (privacy) and the
// per-segment log firehose is silenced. Use `dbg(...)` instead of console.log.
const DBG = process.env.NODE_ENV !== "production";
const dbg: typeof console.log = DBG ? console.log.bind(console) : () => {};

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
  /**
   * When true, apply the session-wide speaker lock: after warmup, lock onto the
   * dominant speaker and DROP segments dominated by anyone else ("ignore side
   * conversations"). When false (default), every source-language segment is
   * kept — the lock never drops anyone, so a multi-speaker Q&A/dialogue is
   * captured in full. The transient-noise defenses (confidence floor,
   * off-language gate, single-word filter) stay active regardless.
   */
  mainSpeakerOnly?: boolean;
}

export interface UseDeepgramReturn {
  segments: LiveSegment[];
  interimText: string;
  connectionState: ConnectionState;
  error: string | null;
  reconnectAttempt: number;
  resetTranscript: () => void;
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
  mainSpeakerOnly = false,
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

  // Latest mainSpeakerOnly, read inside the message handler so toggling it
  // mid-session takes effect immediately without tearing down the WS.
  const mainSpeakerOnlyRef = useRef(mainSpeakerOnly);
  useEffect(() => {
    mainSpeakerOnlyRef.current = mainSpeakerOnly;
  }, [mainSpeakerOnly]);

  // Speaker lock. Once locked, segments where the dominant speaker isn't the
  // locked speaker are dropped (per user policy: "ignore side conversations").
  // Reset on every NEW SOCKET, not just at teardown: Deepgram's speaker
  // indices are per-connection, so a lock carried across a reconnect could
  // point at a different person and drop the khateeb for the rest of the
  // session. Same policy as the Speechmatics core.
  //
  // Deepgram keys speakers by numeric index; Speechmatics uses labels like
  // "S1". Same module, same policy, different key type — which is why the lock
  // is generic. See src/lib/stt/speaker-lock.ts.
  const speakerLockRef = useRef(
    createSpeakerLock<number>({
      warmupMs: DEEPGRAM.speakerLockWarmupMs,
      minDurationS: DEEPGRAM.speakerLockMinDurationS,
      diarizeWarmupMs: DEEPGRAM.diarizeWarmupMs,
    }),
  );
  // The lock's clock: audio actually SENT on the current socket (not wall
  // time, which counted idle prewarm and pauses toward the warmups).
  const lockAudioMsRef = useRef(0);

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
      speakerLockRef.current.reset();
      lockAudioMsRef.current = 0;
      return;
    }

    const myGeneration = ++generationRef.current;
    const isLive = () => generationRef.current === myGeneration;

    // Closure-local state. NOT refs. This entire block is torn down on
    // the next mount, and nothing leaks into the re-mount.
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let hasEverOpened = false;
    // Watchdog for a socket that stalls in CONNECTING (captive portal that
    // 200s the upgrade, cell↔wifi handoff mid-connect, black-holed 101). None
    // of onopen/onclose/onerror fire in that case, so without this the hook
    // sits in "connecting" forever with no transcript and no reconnect.
    let openWatchdog: number | null = null;
    const clearWatchdog = () => {
      if (openWatchdog !== null) {
        window.clearTimeout(openWatchdog);
        openWatchdog = null;
      }
    };

    setReconnectAttempt(0);
    setError(null);

    const tearDown = () => {
      clearWatchdog();
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
      // Idempotent: if a reconnect is already pending, don't schedule a second
      // one. The open watchdog can call this directly AND the watchdog's
      // close() can fire onclose which calls it again — without this guard the
      // two would arm two timers and race two connect() attempts.
      if (reconnectTimer !== null) return;
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
        // Tell the token route the AudioContext's REAL sample rate so Deepgram
        // decodes the raw Linear16 frames at the rate they were captured at.
        // On browsers that ignored our 16kHz request (some Safari/iOS) this is
        // 44100/48000; sending it prevents empty/garbled transcripts.
        const rate = Math.round(pcmNode?.context?.sampleRate ?? 16000);
        const res = await fetch(
          `/api/deepgram?language=${encodeURIComponent(
            sourceLanguage
          )}&sample_rate=${rate}`,
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
      dbg("[deepgram] opening WS:", creds.url, {
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

      // Arm the open watchdog: if the socket hasn't reached OPEN within 8s,
      // force-close it and fall into the normal reconnect/backoff path rather
      // than hanging in "connecting" indefinitely. onopen/onclose both clear it.
      clearWatchdog();
      openWatchdog = window.setTimeout(() => {
        openWatchdog = null;
        if (cancelled || !isLive() || ws !== currentWs) return;
        if (currentWs.readyState !== WebSocket.OPEN) {
          dbg("[deepgram] open watchdog fired — socket stuck connecting, retrying");
          // Detach handlers BEFORE the forced close. A close() on a CONNECTING
          // socket fires onclose with code 1006 + !hasEverOpened, which would
          // otherwise hit the handshake-rejection branch and flash a misleading
          // "temp key rejected" terminal error instead of silently reconnecting.
          // We drive the reconnect ourselves here.
          currentWs.onopen = null;
          currentWs.onmessage = null;
          currentWs.onerror = null;
          currentWs.onclose = null;
          if (ws === currentWs) ws = null;
          if (liveControlsRef.current.ws === currentWs) {
            liveControlsRef.current = { ws: null };
          }
          try {
            currentWs.close();
          } catch {
            /* ignore */
          }
          scheduleReconnect();
        }
      }, 8000);

      currentWs.onopen = () => {
        clearWatchdog();
        dbg("[deepgram] ws onopen — authenticated successfully", {
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
        setError(null); // clear any stale error from a prior failed attempt
        attempt = 0;
        hasEverOpened = true;
        setReconnectAttempt(0);
        // New socket → new speaker indices → re-learn the main speaker.
        speakerLockRef.current.reset();
        lockAudioMsRef.current = 0;

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
          const rate = pcmNode.context?.sampleRate ?? 16000;
          lockAudioMsRef.current += (data.byteLength / (2 * rate)) * 1000;
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
          if (confidence < DEEPGRAM.finalConfidenceFloor) {
            dbg(
              `[deepgram] dropped low-confidence final (${confidence.toFixed(
                2
              )}): "${transcript.slice(0, 60)}"`
            );
            setInterimText("");
            return;
          }
          // Off-language gate (deterministic, primary signal). The Deepgram
          // connection runs in multilingual mode for RTL sources, so non-source
          // speech arrives in its OWN script (Latin for English in an Arabic
          // session) rather than Arabic-transliterated gibberish. Drop it before
          // it enters the transcript — this replaced the removed Whisper
          // language ID. Shares src/lib/script.ts with the server noise filter.
          if (isOffLanguageScript(transcript, sourceLanguage)) {
            dbg(
              `[deepgram] dropped off-language segment (script): "${transcript.slice(
                0,
                60
              )}"`
            );
            setInterimText("");
            return;
          }
          // Secondary off-language drop via Deepgram's own per-segment language
          // detection. In multilingual mode Deepgram may now populate
          // detected_language / language_confidence; when present this fires as
          // a free extra layer (it was inert under the old forced-language setup).
          const detectedLang = msg.channel.detected_language;
          const langConf = msg.channel.language_confidence ?? 0;
          if (
            detectedLang &&
            langConf >= DEEPGRAM.languageMismatchDropThreshold &&
            !detectedLang.toLowerCase().startsWith(sourceLanguage.toLowerCase())
          ) {
            dbg(
              `[deepgram] dropped off-language segment (detected=${detectedLang} @ ${langConf.toFixed(
                2
              )}, source=${sourceLanguage}): "${transcript.slice(0, 60)}"`
            );
            setInterimText("");
            return;
          }
          // Pick the dominant RAW speaker for this segment by total word
          // duration. Falls back to the first word's speaker, then undefined if
          // no speaker info (diarization disabled or single-speaker session).
          const words = alt?.words ?? [];
          let rawSpeaker: number | undefined;
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
                  rawSpeaker = s;
                }
              }
            } else if (typeof words[0].speaker === "number") {
              rawSpeaker = words[0].speaker;
            }
          }

          // Deepgram's live diarizer is unreliable for the first ~25s: it parks
          // all speech on speaker 0, then re-clusters and may renumber the same
          // person to a higher index. The lock ignores diarization entirely
          // within that window (DEEPGRAM.diarizeWarmupMs) — no accounting, no
          // per-segment speaker id — so a lone khateeb isn't split into
          // "Speaker 1" + "Speaker 2".
          const sessionAgeMs = lockAudioMsRef.current;
          const lock = speakerLockRef.current;

          // Speaker lock (operates on RAW indices) — accumulate per-speaker
          // speech duration across the session; once we have enough signal,
          // lock onto the speaker with the most total speech and drop later
          // segments dominated by anyone else. This implements "ignore side
          // conversations and sounds".
          for (const w of words) {
            if (typeof w.speaker !== "number") continue;
            lock.observe(w.speaker, (w.end ?? 0) - (w.start ?? 0), sessionAgeMs);
          }

          const lockedBefore = lock.locked();
          lock.maybeLock(sessionAgeMs);
          const lockedNow = lock.locked();
          if (lockedBefore === null && lockedNow !== null) {
            dbg(
              `[deepgram] locked to speaker ${lockedNow} after ${(
                sessionAgeMs / 1000
              ).toFixed(1)}s of session`
            );
          }

          // Locked, "main speaker only" is ON, and this segment's dominant
          // speaker isn't the locked one. Drop it — it's a side conversation.
          // When the toggle is OFF we keep every speaker's segments (the lock
          // still tracks durations above, so flipping the toggle ON later takes
          // effect immediately).
          if (
            lock.shouldDrop(
              rawSpeaker,
              sessionAgeMs,
              mainSpeakerOnlyRef.current
            )
          ) {
            dbg(
              `[deepgram] dropped side-speaker segment (speaker=${rawSpeaker}, locked=${lockedNow}): "${transcript.slice(
                0,
                60
              )}"`
            );
            setInterimText("");
            return;
          }

          // Display speaker: re-based to first-seen order so the main speaker
          // reads as "Speaker 1" regardless of how Deepgram numbered it.
          // Undefined during the diarize warmup (no reliable id yet) — the badge
          // is hidden for those segments, which is correct for a lone speaker.
          const speaker = lock.displayIndex(rawSpeaker, sessionAgeMs);

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
          if (interimConfidence >= DEEPGRAM.interimConfidenceFloor) {
            setInterimText(transcript);
          }
        }
      };

      currentWs.onerror = (event) => {
        // The browser hides the actual cause for security reasons; this is
        // a generic Event with no useful detail. The follow-up `onclose`
        // gets the close code which is what we actually act on.
        dbg("[deepgram] ws onerror (details hidden by browser)", event);
      };

      currentWs.onclose = (event) => {
        clearWatchdog();
        dbg("[deepgram] ws onclose", {
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
              : `Could not reach the local Deepgram proxy (close code ${event.code}). Make sure the dev server was started with \`bun run dev\` (which uses server.js, not bare \`next dev\`). If the startup banner lists \`- Proxy: /api/deepgram-ws → Deepgram (loopback)\`, the proxy is up — in that case the problem is the proxy → Deepgram leg; check the server log for [deepgram-proxy] errors.`
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
  }, [pcmNode, sourceLanguage, enabled]);

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
    }, DEEPGRAM.keepAliveIntervalMs);
    return () => window.clearInterval(interval);
  }, [paused, enabled]);

  return {
    segments,
    interimText,
    connectionState,
    error,
    reconnectAttempt,
    resetTranscript,
  };
}
