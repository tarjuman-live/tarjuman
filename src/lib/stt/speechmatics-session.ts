/**
 * Production Speechmatics realtime session — framework-free.
 *
 * This is the protocol + policy core that used to live inside
 * use-speechmatics.ts. It was extracted (2026-09-28) so the web hook AND the
 * native iOS app run the exact same code: credential fetch, StartRecognition
 * config, RecognitionStarted audio gating, word→sentence accumulation, the
 * confidence floor, the off-language script gate, the speaker lock, reconnect
 * backoff and the cross-socket timestamp offset. A second copy on mobile would
 * be exactly the "fallback whose policy silently diverges" CLAUDE.md warns
 * about — it only shows up in the field, which is the worst place to find it.
 *
 * Callers own only platform concerns: where PCM frames come from (an
 * AudioWorkletNode on web, a native recorder on iOS), how the auth token is
 * attached, and how state is rendered. Everything here uses only globals that
 * exist in both browsers and React Native (WebSocket, fetch, setTimeout).
 *
 * PROTOCOL NOTES that differ from Deepgram and matter here:
 *   - Audio sent before RecognitionStarted is DISCARDED by the server, so
 *     frames that arrive before the ack (cold start, every reconnect) are HELD
 *     here — bounded by PENDING_AUDIO_MAX_SEC — and sent in order on the ack.
 *     Dropping them lost the first 1-2s of every recording and every reconnect.
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

import type { ConnectionState, LiveSegment } from "../../types";
import { RECONNECT_BACKOFF, SPEECHMATICS } from "../constants";
import { isOffLanguageScript } from "../script";
import { keytermsFor } from "./keyterms";
import { createSpeakerLock } from "./speaker-lock";

interface SmAlternative {
  content?: string;
  confidence?: number;
  speaker?: string;
}

interface SmResult {
  type?: string;
  is_eos?: boolean;
  start_time?: number;
  end_time?: number;
  alternatives?: SmAlternative[];
}

interface SmMessage {
  message: string;
  metadata?: { start_time?: number; end_time?: number; transcript?: string };
  results?: SmResult[];
  reason?: string;
  type?: string;
}

/** Flush a sentence anyway after this many words, if no is_eos has arrived. */
export const MAX_WORDS_PER_SEGMENT = 25;

/** A socket stalled in CONNECTING (captive portal, wifi↔cell) fires nothing. */
const OPEN_WATCHDOG_MS = 10_000;

/**
 * Most audio held while waiting for RecognitionStarted. Covers a cold start
 * (credential fetch + handshake ≈ 1-2s) with a wide margin; past it the OLDEST
 * audio is shed, so a long outage keeps the most recent speech.
 */
export const PENDING_AUDIO_MAX_SEC = 10;

/**
 * A handshake that fails before any socket has EVER opened (1006) is usually a
 * firewall — but one flaky handshake on masjid wifi looks identical. Retry
 * this many times with a fresh JWT before calling it blocked.
 */
const PRE_OPEN_RETRY_LIMIT = 2;

/**
 * Vendor guidance for quota_exceeded (4005), job_error (4013) and internal
 * errors (1011): retry no sooner than 5-10s.
 */
const SLOW_RETRY_MIN_MS = 5_000;

/**
 * In-band Error types that retrying cannot fix. Everything else
 * (quota_exceeded, job_error, idle_timeout, unknown_error, …) is transient and
 * left to the reconnect that follows the server's close.
 */
const FATAL_ERROR_TYPES = new Set([
  "invalid_message",
  "invalid_model",
  "invalid_language",
  "invalid_config",
  "invalid_audio_type",
  "invalid_output_format",
  "not_authorised",
  "not_allowed",
  "timelimit_exceeded",
]);

const QUOTA_MESSAGE =
  "Speechmatics is at its concurrent-session limit. Wait a moment and try again.";

/**
 * Speechmatics' code where it differs from the app's language code. Mandarin
 * is `cmn` there — sending `zh` fails StartRecognition outright.
 */
const SPEECHMATICS_LANGUAGE: Record<string, string> = { zh: "cmn" };

export function speechmaticsLanguageCode(appCode: string): string {
  return SPEECHMATICS_LANGUAGE[appCode] ?? appCode;
}

/**
 * Speechmatics labels a word it can't attribute "UU". That is not a speaker:
 * counting it would let "unknown" win the speaker lock, and treating it as one
 * would drop every unattributed sentence once the lock is taken.
 */
const UNKNOWN_SPEAKER = "UU";

export interface SpeechmaticsSessionOptions {
  sourceLanguage: string;
  /**
   * The capture pipeline's REAL sample rate, read at connect time. Browsers
   * (notably iOS Safari) may ignore a 16 kHz request; declaring the wrong rate
   * makes Speechmatics decode at the wrong speed and return garbage.
   */
  getSampleRate: () => number | undefined;
  /**
   * POST the app's /api/speechmatics route with the caller's auth attached.
   * Web passes a relative URL; native passes an absolute one.
   */
  fetchCredentials: () => Promise<Response>;
  isPaused: () => boolean;
  isMainSpeakerOnly: () => boolean;
  onSegment: (segment: LiveSegment) => void;
  onInterim: (text: string) => void;
  onState: (state: ConnectionState) => void;
  onError: (message: string | null) => void;
  onReconnectAttempt: (attempt: number) => void;
  /** Test seam. Defaults to the global WebSocket. */
  createWebSocket?: (url: string) => WebSocket;
  makeId?: () => string;
  log?: (...args: unknown[]) => void;
}

export interface SpeechmaticsSession {
  /**
   * Forward one Int16 PCM frame. Dropped while paused; held (bounded) until
   * the server acks, then sent in order.
   */
  sendFrame: (frame: ArrayBuffer) => void;
  /** Flush the pending sentence, send EndOfStream, close. Idempotent. */
  stop: () => void;
}

function defaultMakeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Rebuilds transcript text from a results array, honoring punctuation. */
export function textFromResults(results: SmResult[] | undefined): string {
  if (!results?.length) return "";
  let out = "";
  for (const r of results) {
    const content = r.alternatives?.[0]?.content;
    if (!content) continue;
    if (r.type === "punctuation") out += content;
    else out += (out ? " " : "") + content;
  }
  return out;
}

/** Opens the first connection immediately. */
export function startSpeechmaticsSession(
  opts: SpeechmaticsSessionOptions,
): SpeechmaticsSession {
  const {
    sourceLanguage,
    getSampleRate,
    fetchCredentials,
    isPaused,
    isMainSpeakerOnly,
    onSegment,
    onInterim,
    onState,
    onReconnectAttempt,
    createWebSocket = (url) => new WebSocket(url),
    makeId = defaultMakeId,
    log = () => {},
  } = opts;

  // Errors are sticky in one case (the backoff-exhausted message must not
  // overwrite a more specific earlier cause), so the last one is tracked here.
  let lastError: string | null = null;
  const setError = (msg: string | null) => {
    lastError = msg;
    opts.onError(msg);
  };

  // The speaker lock's clock is AUDIO ACTUALLY SENT on the current socket, not
  // wall time. Wall time counted idle prewarm and pauses, so a user who opened
  // /record and waited 15s started recording with both warmups already spent —
  // the diarizer's noisy first labels went straight into the lock. Reset on
  // every new socket (see connect()).
  let lockAudioMs = 0;
  const sessionAge = () => lockAudioMs;
  const lock = createSpeakerLock<string>({
    warmupMs: SPEECHMATICS.speakerLockWarmupMs,
    minDurationS: SPEECHMATICS.speakerLockMinDurationS,
    diarizeWarmupMs: SPEECHMATICS.diarizeWarmupMs,
  });

  let stopped = false;
  let ws: WebSocket | null = null;
  let ready = false; // RecognitionStarted received — audio may flow
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let openWatchdog: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let hasEverOpened = false;
  let preOpenFailures = 0;
  // An in-band Error that retrying can't fix — the close that follows must not
  // schedule a reconnect over it.
  let fatal = false;
  // The last in-band Error asked for the vendor's 5-10s retry spacing.
  let slowRetry = false;
  let seqNo = 0;
  let lastTimestamp = 0;

  // Audio waiting for RecognitionStarted (see PENDING_AUDIO_MAX_SEC).
  let pendingFrames: ArrayBuffer[] = [];
  let pendingBytes = 0;
  const bytesPerSec = () =>
    2 * (getSampleRate() ?? SPEECHMATICS.fallbackSampleRate);

  // Sentence accumulation across AddTranscript word frames.
  let buffer = "";
  let bufferWords = 0;
  let bufferConfs: number[] = [];
  // Per-speaker speech duration WITHIN the sentence being accumulated. The
  // segment is attributed to whoever spoke most of it, matching Deepgram's
  // duration-weighted choice. Taking the first word's speaker instead
  // misattributes any sentence that opens with a brief interjection — and
  // that attribution feeds the speaker lock, so an error there can drop the
  // main speaker or retain a side conversation.
  let bufferSpeakerDurations = new Map<string, number>();
  let bufferStartSec: number | null = null;
  let bufferEndSec: number | null = null;

  // Speechmatics restarts its audio clock at 0 on every new socket. Without
  // an accumulated offset, timestamps would rewind after a reconnect and the
  // persisted transcript would interleave out of order.
  let timeOffsetSec = 0;
  let lastSeenEndSec = 0;

  const dominantBufferSpeaker = (): string | undefined => {
    let best: string | undefined;
    let bestDur = -1;
    for (const [speaker, dur] of bufferSpeakerDurations) {
      if (dur > bestDur) {
        bestDur = dur;
        best = speaker;
      }
    }
    return best;
  };

  const clearWatchdog = () => {
    if (openWatchdog !== null) {
      clearTimeout(openWatchdog);
      openWatchdog = null;
    }
  };

  const resetBuffer = () => {
    buffer = "";
    bufferWords = 0;
    bufferConfs = [];
    bufferSpeakerDurations = new Map();
    bufferStartSec = null;
    bufferEndSec = null;
  };

  const flush = () => {
    const text = buffer.trim();
    const words = bufferWords;
    const confs = bufferConfs;
    const speaker = dominantBufferSpeaker();
    const speakerDurations = bufferSpeakerDurations;
    const startSec = bufferStartSec;
    const endSec = bufferEndSec;
    resetBuffer();
    // Punctuation with no words (a "." that trails a sentence the engine
    // already closed) is not a segment — it would render as an empty card
    // and burn a translation call.
    if (!text || words === 0) return;

    const confidence = confs.length
      ? confs.reduce((a, b) => a + b, 0) / confs.length
      : 1;

    if (confidence < SPEECHMATICS.finalConfidenceFloor) {
      log(`[sm] dropped low-confidence final (${confidence.toFixed(2)})`);
      onInterim("");
      return;
    }

    // Off-language gate. Shares src/lib/script.ts with the server-side noise
    // filter so both agree on what counts as the wrong script.
    if (isOffLanguageScript(text, sourceLanguage)) {
      log(`[sm] dropped off-language segment: "${text.slice(0, 60)}"`);
      onInterim("");
      return;
    }

    // Only speech that survived the floor and the script gate counts toward
    // the lock — the same order use-deepgram.ts uses. Crediting every word as
    // it arrived let a burst of dropped noise or an English announcement win
    // the lock, after which the khateeb himself was dropped as a side speaker.
    const age = sessionAge();
    for (const [spk, dur] of speakerDurations) lock.observe(spk, dur, age);
    lock.maybeLock(age);
    if (lock.shouldDrop(speaker, age, isMainSpeakerOnly())) {
      log(`[sm] dropped side-speaker segment (speaker=${speaker})`);
      onInterim("");
      return;
    }

    const timestamp =
      startSec !== null ? Math.max(0, startSec + timeOffsetSec) : lastTimestamp;
    lastTimestamp = timestamp;
    onSegment({
      id: makeId(),
      text,
      isFinal: true,
      timestamp,
      durationSec:
        startSec !== null && endSec !== null
          ? Math.max(0, endSec - startSec)
          : undefined,
      speaker: lock.displayIndex(speaker, age),
      confidence,
    });
    onInterim("");
  };

  const closeSocket = () => {
    clearWatchdog();
    ready = false;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ message: "EndOfStream", last_seq_no: seqNo }));
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
  };

  /** Send every held frame, in order, on a socket that has just been acked. */
  const drainPending = (socket: WebSocket) => {
    const frames = pendingFrames;
    pendingFrames = [];
    pendingBytes = 0;
    for (const frame of frames) {
      socket.send(frame);
      seqNo++;
      lockAudioMs += (frame.byteLength / bytesPerSec()) * 1000;
    }
  };

  /**
   * Retire a socket we are replacing (watchdog) WITHOUT letting its late
   * close/message events touch the session — a stale onclose used to flip
   * `ready` off under the live socket (audio silently dropped while the UI
   * said "connected") and schedule a third, leaked connection.
   */
  const abandon = (socket: WebSocket) => {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  };

  const scheduleReconnect = (minDelayMs = 0) => {
    if (stopped || reconnectTimer !== null) return;
    if (attempt >= RECONNECT_BACKOFF.length) {
      onState("error");
      setError(
        lastError ??
          `Could not reach Speechmatics after ${RECONNECT_BACKOFF.length} attempts. Check your network connection.`,
      );
      return;
    }
    const delay = Math.max(RECONNECT_BACKOFF[attempt], minDelayMs);
    attempt += 1;
    onReconnectAttempt(attempt);
    onState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) void connect();
    }, delay);
  };

  const connect = async () => {
    if (stopped) return;
    onState(attempt === 0 ? "connecting" : "reconnecting");

    // Emit whatever sentence was mid-accumulation BEFORE the clock advances.
    // Speechmatics finals arrive per-word and only become a segment at
    // `is_eos`, so a socket that drops mid-sentence leaves confirmed vendor
    // output sitting in the buffer. Resetting without flushing threw it away.
    // Order matters: flush against the CURRENT offset, then advance it.
    flush();
    timeOffsetSec += lastSeenEndSec;
    lastSeenEndSec = 0;
    resetBuffer();
    // Speaker labels are per-SOCKET: "S1" on the new connection need not be
    // the person who was "S1" before the drop. Keeping the old lock across a
    // reconnect could lock out the khateeb for the rest of the khutbah, so
    // every new socket re-enters warmup and re-learns the main speaker.
    lock.reset();
    lockAudioMs = 0;
    slowRetry = false;

    let creds: { jwt: string; url: string };
    try {
      const res = await fetchCredentials();
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let msg = `Speechmatics credentials failed (${res.status})`;
        try {
          const parsed = JSON.parse(body);
          if (parsed?.error) msg = String(parsed.error);
        } catch {
          /* non-JSON (a thrown route returns HTML) — keep the status form */
        }
        // Only a misconfigured server (500 with no key) or a hard plan/auth
        // refusal is worth giving up on. Everything else — 429, 5xx, a dropped
        // request on masjid wifi — is transient, and retrying is exactly what
        // the backoff exists for. Treating every failure as terminal ended a
        // live recording on a two-second blip. Mirrors use-deepgram.ts.
        const unrecoverable =
          (res.status === 500 && /API_KEY.*not configured/i.test(msg)) ||
          res.status === 401 ||
          res.status === 402 ||
          res.status === 502;
        if (unrecoverable) {
          setError(msg);
          onState("error");
          return;
        }
        throw new Error(msg);
      }
      creds = (await res.json()) as { jwt: string; url: string };
      if (!creds.jwt || !creds.url) {
        throw new Error("Speechmatics credentials missing in server response");
      }
    } catch (e) {
      if (stopped) return;
      setError(e instanceof Error ? e.message : String(e));
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    const currentWs = createWebSocket(
      `${creds.url}?jwt=${encodeURIComponent(creds.jwt)}`,
    );
    currentWs.binaryType = "arraybuffer";
    ws = currentWs;

    clearWatchdog();
    openWatchdog = setTimeout(() => {
      if (stopped || ws !== currentWs) return;
      if (currentWs.readyState === WebSocket.CONNECTING || !ready) {
        log("[sm] open/ack watchdog fired — forcing reconnect");
        ws = null;
        ready = false;
        abandon(currentWs);
        scheduleReconnect();
      }
    }, OPEN_WATCHDOG_MS);

    currentWs.onopen = () => {
      if (stopped || ws !== currentWs) {
        try {
          currentWs.close(1000);
        } catch {
          /* ignore */
        }
        return;
      }
      hasEverOpened = true;
      seqNo = 0;

      const transcription_config: Record<string, unknown> = {
        language: speechmaticsLanguageCode(sourceLanguage),
        enable_partials: true,
        max_delay: SPEECHMATICS.maxDelay,
        max_delay_mode: "flexible",
        operating_point: SPEECHMATICS.operatingPoint,
        diarization: "speaker",
        // Speaker focus — the vendor-native counterpart to the speaker lock.
        speaker_diarization_config: { prefer_current_speaker: true },
        additional_vocab: keytermsFor(sourceLanguage).map((content) => ({
          content,
        })),
      };

      currentWs.send(
        JSON.stringify({
          message: "StartRecognition",
          audio_format: {
            type: "raw",
            encoding: "pcm_s16le",
            sample_rate: Math.round(
              getSampleRate() ?? SPEECHMATICS.fallbackSampleRate,
            ),
          },
          transcription_config,
        }),
      );
    };

    currentWs.onmessage = (event) => {
      if (stopped || ws !== currentWs) return;
      if (typeof event.data !== "string") return;
      let msg: SmMessage;
      try {
        msg = JSON.parse(event.data) as SmMessage;
      } catch {
        return;
      }

      switch (msg.message) {
        case "RecognitionStarted":
          clearWatchdog();
          ready = true; // only now may audio flow — the server discards earlier frames
          attempt = 0;
          preOpenFailures = 0;
          onState("connected");
          setError(null);
          onReconnectAttempt(0);
          drainPending(currentWs);
          return;

        case "AddPartialTranscript": {
          // `||` not `??`: Speechmatics sends metadata.transcript as "" on
          // empty partials, and an empty string must fall through to the
          // results array rather than be treated as a real (blank) answer.
          const tail =
            msg.metadata?.transcript?.trim() || textFromResults(msg.results);
          onInterim([buffer.trim(), tail].filter(Boolean).join(" ").trim());
          return;
        }

        case "AddTranscript": {
          for (const r of msg.results ?? []) {
            const alt = r.alternatives?.[0];
            const content = alt?.content;
            if (!content) continue;

            if (r.type === "punctuation") {
              buffer += content;
            } else {
              buffer += (buffer ? " " : "") + content;
              bufferWords++;
              if (typeof alt?.confidence === "number") {
                bufferConfs.push(alt.confidence);
              }
              if (bufferStartSec === null && typeof r.start_time === "number") {
                bufferStartSec = r.start_time;
              }
              // Per-speaker duration WITHIN this sentence: flush() attributes
              // the segment to whoever spoke most of it, and — only once the
              // sentence has passed the confidence floor and script gate —
              // credits those durations to the speaker lock.
              if (
                alt?.speaker &&
                alt.speaker !== UNKNOWN_SPEAKER &&
                typeof r.start_time === "number" &&
                typeof r.end_time === "number"
              ) {
                const dur = Math.max(0, r.end_time - r.start_time);
                bufferSpeakerDurations.set(
                  alt.speaker,
                  (bufferSpeakerDurations.get(alt.speaker) ?? 0) + dur,
                );
              }
            }
            if (typeof r.end_time === "number") bufferEndSec = r.end_time;
          }
          if (typeof msg.metadata?.end_time === "number") {
            bufferEndSec = msg.metadata.end_time;
          }
          if (bufferEndSec !== null) lastSeenEndSec = bufferEndSec;

          const sentenceEnded = (msg.results ?? []).some((r) => r.is_eos);
          if (sentenceEnded || bufferWords >= MAX_WORDS_PER_SEGMENT) {
            flush();
          } else {
            // Keep interim text in step with the committed-but-unflushed
            // buffer. The record screen captures interim text on Stop to
            // rescue the closing words; if this only updated on
            // AddPartialTranscript, a Stop landing between a committed word
            // and the next partial would rescue a stale string missing it.
            onInterim(buffer.trim());
          }
          return;
        }

        case "Error": {
          const type = msg.type ?? "error";
          const detail = `${type}: ${msg.reason ?? "unknown"}`;
          log("[sm] in-band error", detail);
          if (FATAL_ERROR_TYPES.has(type)) {
            // Retrying can't fix these. Flag it so the close that follows
            // doesn't flip the error back to "reconnecting" and burn a JWT
            // per attempt for a minute.
            fatal = true;
            pendingFrames = [];
            pendingBytes = 0;
            setError(
              type === "timelimit_exceeded"
                ? "Speechmatics usage limit reached for this account."
                : `Speechmatics error — ${detail}`,
            );
            onState("error");
            return;
          }
          // Transient. quota_exceeded is the one users will actually hit — the
          // free tier allows only 2 concurrent sessions app-wide — and a slot
          // frees as soon as someone else stops, so it's retried (at the
          // vendor's 5-10s spacing) by the close that follows rather than
          // ending the recording.
          if (type === "quota_exceeded" || type === "job_error") {
            slowRetry = true;
          }
          setError(
            type === "quota_exceeded" ? QUOTA_MESSAGE : `Speechmatics error — ${detail}`,
          );
          return;
        }

        case "Warning":
          log("[sm] warning", msg.type, msg.reason);
          return;

        default:
          return;
      }
    };

    currentWs.onerror = () => {
      // Browsers hide the cause; the follow-up onclose carries the code.
      log("[sm] ws onerror (details hidden)");
    };

    currentWs.onclose = (event) => {
      // A socket we already replaced or retired must never touch the live
      // one's state.
      if (ws !== currentWs) return;
      clearWatchdog();
      log("[sm] ws onclose", { code: event.code, reason: event.reason });
      ws = null;
      ready = false;

      if (stopped || fatal) return;

      const code = event.code;
      // Not fixed by retrying: bad credentials, a language the account can't
      // use, or the account's usage quota.
      if (code === 4001 || code === 4003) {
        setError("Speechmatics rejected the session credentials.");
        onState("error");
        return;
      }
      if (code === 4004) {
        setError(
          `Speechmatics can't transcribe this language (${speechmaticsLanguageCode(sourceLanguage)}).`,
        );
        onState("error");
        return;
      }
      if (code === 4006) {
        setError("Speechmatics usage limit reached for this account.");
        onState("error");
        return;
      }
      // Transient on the vendor's side — retry, but no sooner than 5-10s.
      if (code === 4005) {
        setError(QUOTA_MESSAGE);
        scheduleReconnect(SLOW_RETRY_MIN_MS);
        return;
      }
      if (code === 4013 || code === 1011 || slowRetry) {
        scheduleReconnect(SLOW_RETRY_MIN_MS);
        return;
      }
      // Rejected before any socket ever opened: usually a firewall, but a
      // single flaky handshake looks the same. A few retries, then say so.
      if (code === 1006 && !hasEverOpened) {
        preOpenFailures += 1;
        if (preOpenFailures > PRE_OPEN_RETRY_LIMIT) {
          setError(
            "Could not open a Speechmatics connection. A firewall or network policy may be blocking it.",
          );
          onState("error");
          return;
        }
      }
      // Everything else reconnects — including a server-side 1000/1008
      // (proxy recycle, idle timeout) while we're still recording, which used
      // to leave the UI silently "idle" under a running timer.
      scheduleReconnect();
    };
  };

  void connect();

  return {
    sendFrame(frame) {
      if (stopped || fatal || isPaused()) return;
      if (!frame || frame.byteLength === 0) return;
      const current = ws;
      if (ready && current && current.readyState === WebSocket.OPEN) {
        current.send(frame);
        seqNo++;
        lockAudioMs += (frame.byteLength / bytesPerSec()) * 1000;
        return;
      }
      // Not acked yet (cold start or reconnect): hold it. Copied, because a
      // producer may reuse its buffer once the callback returns.
      pendingFrames.push(frame.slice(0));
      pendingBytes += frame.byteLength;
      const cap = PENDING_AUDIO_MAX_SEC * bytesPerSec();
      while (pendingBytes > cap && pendingFrames.length > 1) {
        pendingBytes -= pendingFrames.shift()!.byteLength;
      }
    },
    stop() {
      if (stopped) return;
      // Emit whatever sentence was mid-accumulation so the last words of a
      // recording are not silently lost on stop.
      flush();
      stopped = true;
      pendingFrames = [];
      pendingBytes = 0;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      closeSocket();
    },
  };
}
