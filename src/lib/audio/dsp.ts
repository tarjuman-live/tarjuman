/**
 * Speech-cleanup DSP chain + PCM framer — pure TypeScript, no Web Audio.
 *
 * The web app builds this chain out of Web Audio nodes (audio-processor.ts)
 * and frames it in public/pcm-worklet.js. The native app has no Web Audio
 * graph worth trusting for this, so it runs the SAME chain here, in JS, on the
 * Float32 buffers the native recorder hands over. At 16 kHz mono that is ~16k
 * samples/s through two biquads and a compressor — trivial CPU.
 *
 * The tuning lives in AUDIO_DSP so both platforms read one set of numbers:
 * PA audio in a reverberant masjid is the whole use case (see CLAUDE.md), and
 * a chain that silently differs between web and iOS would make field-test
 * results from one platform meaningless for the other.
 *
 *   highpass 120 Hz → lowpass 7 kHz → compressor (-26 dB, 4:1) → gain 1.6
 *     → 40 ms frames → -55 dBFS noise gate (zero-fill) → Int16 LE
 */

export const AUDIO_DSP = {
  /** Cuts wind rumble, AC hum, foot shuffling. */
  highpassHz: 120,
  /** Cuts outdoor hiss + crowd sibilance above the consonant band. */
  lowpassHz: 7000,
  /** Web Audio biquad Q for lowpass/highpass — expressed in dB per the spec. */
  filterQ: 0.7,
  compressor: {
    thresholdDb: -26,
    kneeDb: 6,
    ratio: 4,
    attackS: 0.003,
    releaseS: 0.25,
  },
  /** Post-compression gain for distant PA capture. */
  gain: 1.6,
  /** Frame length sent to the STT engine. */
  frameMs: 40,
  /** 10^(-55/20): frames below this RMS are sent as clean silence. */
  noiseGateLinear: 0.001778,
} as const;

/** Samples per 40 ms frame at the REAL capture rate (640 @16k, 1920 @48k). */
export function frameSizeFor(sampleRate: number): number {
  return Math.max(160, Math.round((sampleRate * AUDIO_DSP.frameMs) / 1000));
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/**
 * RBJ cookbook biquad, with Q interpreted in dB exactly as Web Audio's
 * BiquadFilterNode does for lowpass/highpass — so Q=0.7 here means what the
 * web graph's `Q.value = 0.7` means.
 */
function makeBiquad(
  type: "lowpass" | "highpass",
  freq: number,
  qDb: number,
  sampleRate: number,
): Biquad {
  const f = Math.min(freq, sampleRate / 2 - 1);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const a0 = 1 + alpha;
  const lp = type === "lowpass";
  const b0 = (lp ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  const b1 = (lp ? 1 - cos : -(1 + cos)) / a0;
  return {
    b0,
    b1,
    b2: b0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

function runBiquad(bq: Biquad, x: number): number {
  const y =
    bq.b0 * x + bq.b1 * bq.x1 + bq.b2 * bq.x2 - bq.a1 * bq.y1 - bq.a2 * bq.y2;
  bq.x2 = bq.x1;
  bq.x1 = x;
  bq.y2 = bq.y1;
  bq.y1 = y;
  return y;
}

/** Soft-knee static curve: output level (dB) for an input level (dB). */
function compressCurveDb(xDb: number): number {
  const { thresholdDb: t, kneeDb: w, ratio: r } = AUDIO_DSP.compressor;
  const over = xDb - t;
  if (2 * over < -w) return xDb;
  if (2 * Math.abs(over) <= w) {
    return xDb + ((1 / r - 1) * (over + w / 2) ** 2) / (2 * w);
  }
  return t + over / r;
}

/**
 * Web Audio's DynamicsCompressorNode applies automatic makeup gain
 * ((1/fullRangeGain)^0.6), which is a large part of why the web chain lifts
 * distant speech. Omitting it here would leave native audio ~12 dB quieter.
 */
const MAKEUP_DB = -0.6 * compressCurveDb(0);

export interface SpeechChain {
  /** Filters + compresses + gains `samples` IN PLACE and returns them. */
  process: (samples: Float32Array) => Float32Array;
}

export function createSpeechChain(sampleRate: number): SpeechChain {
  const hp = makeBiquad(
    "highpass",
    AUDIO_DSP.highpassHz,
    AUDIO_DSP.filterQ,
    sampleRate,
  );
  const lp = makeBiquad(
    "lowpass",
    AUDIO_DSP.lowpassHz,
    AUDIO_DSP.filterQ,
    sampleRate,
  );
  const attack = Math.exp(-1 / (AUDIO_DSP.compressor.attackS * sampleRate));
  const release = Math.exp(-1 / (AUDIO_DSP.compressor.releaseS * sampleRate));
  let gainDb = 0; // smoothed gain reduction (≤ 0)

  return {
    process(samples) {
      for (let i = 0; i < samples.length; i++) {
        const x = runBiquad(lp, runBiquad(hp, samples[i]));
        const levelDb = 20 * Math.log10(Math.abs(x) + 1e-9);
        const targetDb = compressCurveDb(levelDb) - levelDb;
        // Attack when reduction deepens, release when it recovers.
        const coef = targetDb < gainDb ? attack : release;
        gainDb = coef * gainDb + (1 - coef) * targetDb;
        samples[i] =
          x * Math.pow(10, (gainDb + MAKEUP_DB) / 20) * AUDIO_DSP.gain;
      }
      return samples;
    },
  };
}

export interface PcmFramer {
  /** Accepts processed Float32 samples of any length. */
  push: (samples: Float32Array) => void;
  /** Drops any partial frame (e.g. on pause, so stale audio isn't sent). */
  reset: () => void;
}

/**
 * Re-chunks samples into exact 40 ms frames and converts to Int16 LE,
 * zero-filling frames under the noise gate. Mirrors public/pcm-worklet.js:
 * silence is SENT (as zeros), never dropped, so the engine's endpointing sees
 * a steady cadence. `rms` is the pre-gate level, for the level meter.
 */
export function createPcmFramer(
  sampleRate: number,
  onFrame: (frame: ArrayBuffer, rms: number) => void,
): PcmFramer {
  const size = frameSizeFor(sampleRate);
  const buf = new Float32Array(size);
  let idx = 0;

  const emit = () => {
    let sumSq = 0;
    for (let j = 0; j < size; j++) sumSq += buf[j] * buf[j];
    const rms = Math.sqrt(sumSq / size);
    const int16 = new Int16Array(size);
    if (rms >= AUDIO_DSP.noiseGateLinear) {
      for (let j = 0; j < size; j++) {
        const s = Math.max(-1, Math.min(1, buf[j]));
        int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    onFrame(int16.buffer, rms);
  };

  return {
    push(samples) {
      for (let i = 0; i < samples.length; i++) {
        buf[idx++] = samples[i];
        if (idx >= size) {
          emit();
          idx = 0;
        }
      }
    },
    reset() {
      idx = 0;
    },
  };
}
