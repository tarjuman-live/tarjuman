import { describe, expect, it } from "vitest";
import {
  AUDIO_DSP,
  createPcmFramer,
  createSpeechChain,
  frameSizeFor,
} from "./dsp";

const FS = 16000;

function sine(freq: number, amp: number, seconds: number, fs = FS) {
  const out = new Float32Array(Math.round(fs * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / fs);
  }
  return out;
}

function rms(x: Float32Array, from = 0) {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / (x.length - from));
}

describe("speech chain", () => {
  it("attenuates hum far more than speech-band tone", () => {
    const hum = createSpeechChain(FS).process(sine(40, 0.1, 1));
    const voice = createSpeechChain(FS).process(sine(1000, 0.1, 1));
    // Skip the first half-second so compressor settling doesn't skew it.
    expect(rms(hum, FS / 2)).toBeLessThan(rms(voice, FS / 2) / 4);
  });

  it("lifts quiet distant speech (makeup gain + 1.6x)", () => {
    const quiet = sine(1000, 0.01, 1);
    const inRms = rms(quiet);
    const out = createSpeechChain(FS).process(quiet);
    expect(rms(out, FS / 2)).toBeGreaterThan(inRms * 3);
  });

  it("stays bounded on a loud input", () => {
    const out = createSpeechChain(FS).process(sine(1000, 0.9, 1));
    expect(Number.isFinite(rms(out))).toBe(true);
  });
});

describe("pcm framer", () => {
  it("emits exact 40ms Int16 frames at the real rate", () => {
    for (const fs of [16000, 48000]) {
      const frames: ArrayBuffer[] = [];
      const f = createPcmFramer(fs, (b) => frames.push(b));
      f.push(sine(1000, 0.5, 0.1, fs)); // 100ms → 2 whole frames
      expect(frames).toHaveLength(2);
      expect(frames[0].byteLength).toBe(frameSizeFor(fs) * 2);
    }
    expect(frameSizeFor(16000)).toBe(640);
  });

  it("zero-fills frames under the -55 dBFS gate instead of dropping them", () => {
    const frames: Int16Array[] = [];
    const f = createPcmFramer(FS, (b) => frames.push(new Int16Array(b)));
    f.push(sine(1000, AUDIO_DSP.noiseGateLinear / 4, 0.04));
    f.push(sine(1000, 0.5, 0.04));
    expect(frames).toHaveLength(2);
    expect(frames[0].every((s) => s === 0)).toBe(true);
    expect(frames[1].some((s) => s !== 0)).toBe(true);
  });

  it("reset drops a partial frame", () => {
    const frames: ArrayBuffer[] = [];
    const f = createPcmFramer(FS, (b) => frames.push(b));
    f.push(new Float32Array(600));
    f.reset();
    f.push(new Float32Array(600));
    expect(frames).toHaveLength(0);
  });
});
