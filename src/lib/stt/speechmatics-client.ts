/**
 * Raw Speechmatics realtime (RT v2) client for the comparison harness.
 *
 * Protocol (docs.speechmatics.com/api-ref/realtime-transcription-websocket):
 *   1. Open  wss://<region>.rt.speechmatics.com/v2?jwt=<temp key>
 *   2. Send  StartRecognition { audio_format, transcription_config }
 *   3. Wait  RecognitionStarted   ← MUST arrive before any audio is sent
 *   4. Send  raw binary PCM frames
 *   5. Recv  AddPartialTranscript / AddTranscript
 *   6. Send  EndOfStream { last_seq_no }
 *
 * Two things that differ from Deepgram and bite if ignored:
 *   - Audio sent before RecognitionStarted is discarded, so frames are dropped
 *     until the ack lands rather than buffered blindly.
 *   - Errors arrive as an in-band { message: "Error" } frame carrying a real
 *     reason string, *then* the socket closes. Reading that frame is the
 *     difference between "invalid_config: unknown field" and a mystery 1006.
 */

import type { SttClient, SttClientOptions, SttStatus } from "./types";
import { describeHttpError } from "./types";
import { keytermsFor } from "./keyterms";
import { speechmaticsLanguageCode } from "./speechmatics-session";

interface SmAlternative {
  content?: string;
  confidence?: number;
  speaker?: string;
}

interface SmResult {
  type?: string;
  /** True on the punctuation mark that ends a sentence. Drives segment flush. */
  is_eos?: boolean;
  end_time?: number;
  alternatives?: SmAlternative[];
}

interface SmMessage {
  message: string;
  /**
   * NOTE: `transcript` lives inside `metadata`, NOT at the top level — verified
   * against live wire output (format 2.9). Reading msg.transcript silently
   * yields undefined and an empty column.
   */
  metadata?: { start_time?: number; end_time?: number; transcript?: string };
  results?: SmResult[];
  reason?: string;
  type?: string;
  code?: number;
}

export interface SpeechmaticsOptions extends SttClientOptions {
  /** standard | enhanced | melia-1. Enhanced is the accuracy-first tier. */
  model?: string;
  /** Final-transcript delay budget in seconds (0.7–4). Lower = snappier. */
  maxDelay?: number;
  /** Speaker diarization + "speaker focus" (prefer_current_speaker). */
  diarize?: boolean;
}

/** Rebuilds the transcript text from the results array, honoring punctuation. */
function textFromResults(results: SmResult[] | undefined): string {
  if (!results?.length) return "";
  let out = "";
  for (const r of results) {
    const content = r.alternatives?.[0]?.content;
    if (!content) continue;
    // Punctuation attaches to the previous token with no separating space.
    if (r.type === "punctuation") out += content;
    else out += (out ? " " : "") + content;
  }
  return out;
}

export function createSpeechmaticsClient(opts: SpeechmaticsOptions): SttClient {
  const {
    sourceLanguage,
    sampleRate,
    useKeyterms,
    authToken,
    handlers,
    model = "enhanced",
    maxDelay = 1.5,
    diarize = true,
  } = opts;

  let ws: WebSocket | null = null;
  let ready = false;
  let stopped = false;
  let startedAt = 0;
  let seqNo = 0;
  let seq = 0;

  const setStatus = (s: SttStatus) => {
    if (!stopped || s === "stopped" || s === "error") handlers.onStatus(s);
  };

  // ── Sentence accumulation ────────────────────────────────────────────────
  //
  // Speechmatics emits AddTranscript ONE WORD AT A TIME; Deepgram emits whole
  // phrases. Surfacing that raw would make the two columns incomparable — one
  // a word-per-line ticker, the other readable prose — and would understate
  // Speechmatics badly to the eye. So words are buffered into sentences and
  // flushed on the `is_eos` punctuation mark that Speechmatics itself sets.
  //
  // This does NOT fudge the latency: the flush happens the instant the
  // sentence-ending word arrives, so lag is still measured against that word's
  // own end_time. It is the true time-to-readable-sentence for both engines.
  let buffer = "";
  let bufferConfs: number[] = [];
  let bufferSpeaker: string | null = null;
  let bufferEndSec: number | null = null;

  const flush = () => {
    const text = buffer.trim();
    buffer = "";
    const confs = bufferConfs;
    const speaker = bufferSpeaker;
    const endSec = bufferEndSec;
    bufferConfs = [];
    bufferSpeaker = null;
    bufferEndSec = null;
    if (!text) return;

    handlers.onPartial("");
    handlers.onFinal({
      id: `sm-${seq++}`,
      text,
      audioEndSec: endSec,
      arrivedAtMs: Date.now() - startedAt,
      confidence: confs.length
        ? confs.reduce((a, b) => a + b, 0) / confs.length
        : null,
      speaker,
    });
  };

  // Safety valve: an orator can run for a long stretch with no sentence-final
  // punctuation. Without a cap the column would sit empty for minutes while the
  // buffer grew. Flushes mid-sentence rather than showing nothing.
  const MAX_WORDS_PER_SEGMENT = 25;
  let bufferWords = 0;

  const start = async () => {
    setStatus("connecting");

    const res = await fetch("/api/speechmatics", {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    });
    if (!res.ok) {
      // An unhandled throw inside the route returns Next's HTML error page, not
      // JSON — so .json() fails and a naive `body.error` fallback reports a bare
      // status code that says nothing. Fall back to the raw body so the real
      // cause is visible on screen instead of a mystery 500.
      throw new Error(await describeHttpError(res, "Speechmatics"));
    }
    const { jwt, url } = (await res.json()) as { jwt: string; url: string };

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${url}?jwt=${encodeURIComponent(jwt)}`);
      socket.binaryType = "arraybuffer";
      ws = socket;

      socket.onopen = () => {
        // Connection is up but the engine is NOT ready — audio must wait for
        // RecognitionStarted.
        const transcription_config: Record<string, unknown> = {
          language: speechmaticsLanguageCode(sourceLanguage),
          enable_partials: true,
          max_delay: maxDelay,
          max_delay_mode: "flexible",
          operating_point: model,
        };
        if (diarize) {
          transcription_config.diarization = "speaker";
          // "Speaker focus" — the native equivalent of Tarjuman's hand-built
          // speaker lock. Reduces mid-utterance speaker-switching errors.
          transcription_config.speaker_diarization_config = {
            prefer_current_speaker: true,
          };
        }
        if (useKeyterms) {
          // NOTE: Speechmatics documents a ~15s session-init penalty for large
          // additional_vocab lists. keyterms.ts is kept short for this reason.
          transcription_config.additional_vocab = keytermsFor(
            sourceLanguage,
          ).map((content) => ({ content }));
        }

        socket.send(
          JSON.stringify({
            message: "StartRecognition",
            audio_format: {
              type: "raw",
              encoding: "pcm_s16le",
              sample_rate: sampleRate,
            },
            transcription_config,
          }),
        );
      };

      socket.onerror = () => {
        if (!ready) reject(new Error("Speechmatics WebSocket failed to open"));
        else handlers.onError("Speechmatics connection error");
      };

      socket.onclose = (ev) => {
        ready = false;
        if (stopped) return setStatus("stopped");
        handlers.onError(
          `Speechmatics closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`,
        );
        setStatus("error");
        if (!ready) reject(new Error(`Speechmatics closed (${ev.code})`));
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: SmMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.message) {
          case "RecognitionStarted":
            ready = true;
            startedAt = Date.now();
            setStatus("listening");
            resolve();
            return;

          case "AddPartialTranscript": {
            // Show the committed sentence-so-far plus the live tail, so the
            // column reads as continuous prose instead of resetting each word.
            const tail =
              msg.metadata?.transcript?.trim() || textFromResults(msg.results);
            handlers.onPartial([buffer.trim(), tail].filter(Boolean).join(" "));
            return;
          }

          case "AddTranscript": {
            const text =
              msg.metadata?.transcript?.trim() || textFromResults(msg.results);
            if (!text) return;

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
                if (alt?.speaker && !bufferSpeaker) bufferSpeaker = alt.speaker;
              }
              if (typeof r.end_time === "number") bufferEndSec = r.end_time;
            }
            if (typeof msg.metadata?.end_time === "number") {
              bufferEndSec = msg.metadata.end_time;
            }

            const sentenceEnded = (msg.results ?? []).some((r) => r.is_eos);
            if (sentenceEnded || bufferWords >= MAX_WORDS_PER_SEGMENT) {
              bufferWords = 0;
              flush();
            }
            return;
          }

          case "Error":
            // In-band error carries the real reason (invalid_config, quota
            // exceeded, bad language code). Surface it verbatim — this is the
            // message that makes a misconfiguration fixable in one read.
            handlers.onError(
              `Speechmatics ${msg.type ?? "error"}: ${msg.reason ?? "unknown"}`,
            );
            setStatus("error");
            if (!ready) reject(new Error(msg.reason ?? "Speechmatics error"));
            return;

          case "Warning":
            handlers.onError(
              `Speechmatics warning — ${msg.type ?? ""}: ${msg.reason ?? ""}`,
            );
            return;

          default:
            return;
        }
      };
    });
  };

  return {
    start,
    send(frame) {
      // Frames arriving before RecognitionStarted are dropped, not queued:
      // Speechmatics discards pre-ack audio anyway, and queueing would only
      // add a false head-start to the latency numbers.
      if (ready && ws?.readyState === WebSocket.OPEN) {
        ws.send(frame);
        seqNo++;
      }
    },
    stop() {
      // Emit whatever sentence was mid-accumulation. Without this the final
      // words of a run — often the ones being judged — silently vanish.
      flush();
      stopped = true;
      ready = false;
      try {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ message: "EndOfStream", last_seq_no: seqNo }),
          );
        }
        ws?.close();
      } catch {
        /* already closed */
      }
      ws = null;
      setStatus("stopped");
    },
  };
}
