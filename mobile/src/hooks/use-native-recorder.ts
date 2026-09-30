import { useCallback, useEffect, useRef, useState } from "react";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  createPcmFramer,
  createSpeechChain,
  frameSizeFor,
  type PcmFramer,
  type SpeechChain,
} from "@shared/audio/dsp";

/**
 * Native mic → shared DSP chain → 40 ms Int16 PCM frames.
 *
 * The iOS counterpart of the web's use-recorder.ts + audio-processor.ts +
 * pcm-worklet.js. The cleanup chain itself (highpass → lowpass → compressor →
 * gain → -55 dBFS gate) is the SAME module the web tuning is defined in
 * (@shared/audio/dsp), so a field result on one platform means something on
 * the other.
 *
 * Why native at all (vs. wrapping the website): the audio session is
 * `playAndRecord` with the `audio` background mode, so capture keeps running
 * when the phone is locked and pocketed during a 45-minute khutbah — a
 * WKWebView loses the mic the moment the screen locks.
 */

/** Requested capture rate. The REAL rate is read from each delivered buffer. */
const REQUESTED_SAMPLE_RATE = 16000;

/**
 * `voiceChat` engages iOS voice processing (echo cancellation, noise
 * suppression, AGC) — the native equivalent of the web's getUserMedia
 * constraints, which is the configuration the field test passed on. If far-
 * field PA speech ever gets squashed by the voice processor, `measurement`
 * (raw input) is the knob to try — the DSP chain then does all the work.
 */
const IOS_MODE = "voiceChat" as const;

/** Level-meter updates per second (frames arrive at 25/s). */
const LEVEL_EVERY_N_FRAMES = 3;

export type RecorderPhase = "idle" | "starting" | "recording" | "paused" | "error";

export interface NativeRecorder {
  phase: RecorderPhase;
  error: string | null;
  /** Pre-gate RMS of the processed signal, 0..1 (for the level meter). */
  level: number;
  /** The capture pipeline's real rate — null until the first buffer lands. */
  sampleRate: number | null;
  start: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  /** Frames flow only while recording (not paused). Returns unsubscribe. */
  subscribe: (onFrame: (frame: ArrayBuffer) => void) => () => void;
  /**
   * Processed samples BEFORE the -55 dBFS noise gate — the web AnalyserNode's
   * tap point (lib/audio-processor.ts connects it to the gain node, ahead of
   * the worklet's gate). For the level meter only: room tone / a soft PA
   * between phrases must still read as signal there. Delivered for every
   * native buffer while capturing (paused or not); the Float32Array is only
   * valid during the callback. Returns unsubscribe.
   */
  subscribeMeter: (onSamples: MeterListener) => () => void;
  /**
   * Web recorder.recover(): after an OS interruption (call, Siri, another app)
   * the audio engine sits in its Interrupted state and nothing restarts it on
   * its own — reclaim the session and restart the engine via the recorder's
   * resume path. Safe to call when nothing is interrupted.
   */
  recover: () => void;
}

export type MeterListener = (samples: Float32Array, sampleRate: number) => void;

export function useNativeRecorder(): NativeRecorder {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const listenersRef = useRef(new Set<(frame: ArrayBuffer) => void>());
  const meterListenersRef = useRef(new Set<MeterListener>());
  const pausedRef = useRef(false);
  const pipelineRef = useRef<{
    rate: number;
    chain: SpeechChain;
    framer: PcmFramer;
  } | null>(null);
  const frameCountRef = useRef(0);

  const buildPipeline = (rate: number) => {
    const chain = createSpeechChain(rate);
    const framer = createPcmFramer(rate, (frame, rms) => {
      if (++frameCountRef.current % LEVEL_EVERY_N_FRAMES === 0) {
        setLevel(Math.min(1, rms * 8));
      }
      if (pausedRef.current) return;
      for (const fn of listenersRef.current) fn(frame);
    });
    pipelineRef.current = { rate, chain, framer };
    setSampleRate(rate);
  };

  const teardown = useCallback(async () => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) {
      rec.clearOnAudioReady();
      rec.clearOnError();
      try {
        await rec.stop();
      } catch {
        /* already stopped */
      }
    }
    pipelineRef.current = null;
    try {
      await AudioManager.setAudioSessionActivity(false);
    } catch {
      /* session already inactive */
    }
    deactivateKeepAwake("recording");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setPhase("starting");
    try {
      const perm = await AudioManager.requestRecordingPermissions();
      if (perm !== "Granted") {
        setError(
          "Microphone access is off. Enable it for Tarjuman in Settings → Privacy → Microphone.",
        );
        setPhase("error");
        return false;
      }

      AudioManager.setAudioSessionOptions({
        iosCategory: "playAndRecord",
        iosMode: IOS_MODE,
        iosOptions: ["allowBluetoothHFP", "defaultToSpeaker"],
      });
      AudioManager.observeAudioInterruptions(true);
      await AudioManager.setAudioSessionActivity(true);

      const rec = new AudioRecorder();
      recorderRef.current = rec;
      frameCountRef.current = 0;
      pausedRef.current = false;
      setSampleRate(null);

      const ready = rec.onAudioReady(
        {
          sampleRate: REQUESTED_SAMPLE_RATE,
          bufferLength: frameSizeFor(REQUESTED_SAMPLE_RATE),
          channelCount: 1,
        },
        ({ buffer }) => {
          // The OS may not honor the requested rate — the chain's filter
          // coefficients AND the rate declared to Speechmatics must follow
          // what actually arrived (the same trap that bit iOS Safari).
          const rate = Math.round(buffer.sampleRate);
          if (pipelineRef.current?.rate !== rate) buildPipeline(rate);
          const p = pipelineRef.current!;
          // Copy: the native buffer may be reused after this callback.
          const samples = new Float32Array(buffer.getChannelData(0));
          const processed = p.chain.process(samples);
          p.framer.push(processed);
          // The framer copied what it needs; `processed` is still pre-gate.
          for (const fn of meterListenersRef.current) fn(processed, rate);
        },
      );
      if (ready.status === "error") throw new Error(ready.message);

      rec.onError((e) => {
        setError(`Recording error: ${e.message}`);
        setPhase("error");
      });

      const started = await rec.start();
      if (started.status === "error") throw new Error(started.message);

      await activateKeepAwakeAsync("recording");
      setPhase("recording");
      return true;
    } catch (e) {
      await teardown();
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return false;
    }
  }, [teardown]);

  const pause = useCallback(() => {
    // The mic stays open (as on web) so the audio session — and background
    // execution — survive the pause; frames are simply not forwarded.
    pausedRef.current = true;
    pipelineRef.current?.framer.reset();
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPhase("recording");
  }, []);

  const stop = useCallback(async () => {
    pausedRef.current = true;
    await teardown();
    setLevel(0);
    setPhase("idle");
  }, [teardown]);

  const subscribe = useCallback((onFrame: (frame: ArrayBuffer) => void) => {
    const set = listenersRef.current;
    set.add(onFrame);
    return () => {
      set.delete(onFrame);
    };
  }, []);

  const subscribeMeter = useCallback((onSamples: MeterListener) => {
    const set = meterListenersRef.current;
    set.add(onSamples);
    return () => {
      set.delete(onSamples);
    };
  }, []);

  const recover = useCallback(() => {
    if (!recorderRef.current) return;
    void AudioManager.setAudioSessionActivity(true)
      .then(() => recorderRef.current?.resume())
      .catch(() => {});
  }, []);

  // A phone call or Siri takes the audio session. When iOS says it may
  // resume, re-activate it; otherwise surface it so the user isn't left
  // "recording" silence.
  useEffect(() => {
    const sub = AudioManager.addSystemEventListener("interruption", (e) => {
      if (!recorderRef.current) return;
      if (e.type === "ended" && e.shouldResume) {
        void AudioManager.setAudioSessionActivity(true)
          .then(() => recorderRef.current?.resume())
          .catch(() => {});
      }
    });
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  return {
    phase,
    error,
    level,
    sampleRate,
    start,
    pause,
    resume,
    stop,
    subscribe,
    subscribeMeter,
    recover,
  };
}
