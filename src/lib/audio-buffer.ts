/**
 * Ring buffer of recent PCM audio frames + a WAV encoder.
 *
 * Populated as a side effect inside the Deepgram worklet handler (each 40ms
 * frame the worklet sends to Deepgram is also pushed here). When a Deepgram
 * segment finalizes, the translator slices the matching audio window and
 * sends it to OpenAI Whisper for a parallel transcription. Claude then
 * receives both Arabic transcriptions and reconciles them before translating.
 *
 * Audio format: 16kHz mono Int16 PCM (same as what the worklet emits and
 * Deepgram receives, so no resampling).
 *
 * Memory budget: 60s × 16000 samples × 2 bytes ≈ 2MB. Older frames get
 * trimmed once the buffer exceeds the cap so a long session doesn't grow
 * unbounded.
 */

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const MAX_SAMPLES = 60 * SAMPLE_RATE;

export class RollingAudioBuffer {
  private frames: Int16Array[] = [];
  /** Total samples ever pushed since `reset()`. */
  private totalSamples = 0;
  /** Samples dropped off the front to honor MAX_SAMPLES. */
  private droppedSamples = 0;

  reset(): void {
    this.frames = [];
    this.totalSamples = 0;
    this.droppedSamples = 0;
  }

  push(samples: Int16Array): void {
    // Defensive copy — the frame is a transferred ArrayBuffer that may
    // be reused once postMessage returns ownership.
    this.frames.push(new Int16Array(samples));
    this.totalSamples += samples.length;
    while (
      this.frames.length > 0 &&
      this.totalSamples - this.droppedSamples - this.frames[0].length >=
        MAX_SAMPLES
    ) {
      const front = this.frames.shift()!;
      this.droppedSamples += front.length;
    }
  }

  /**
   * Extract samples between `[startSec, endSec]` (relative to the session
   * start = the moment of `reset()`), encode as a WAV Blob.
   *
   * Returns null if the requested window is partially outside the buffered
   * range (e.g., the segment started before the buffer was created, or its
   * audio was trimmed off the front).
   */
  sliceWav(startSec: number, endSec: number): Blob | null {
    if (endSec <= startSec) return null;
    const startSample = Math.floor(Math.max(0, startSec) * SAMPLE_RATE);
    const endSample = Math.ceil(endSec * SAMPLE_RATE);
    if (startSample < this.droppedSamples) return null;
    if (endSample > this.totalSamples) return null;

    const targetLen = endSample - startSample;
    const out = new Int16Array(targetLen);
    let outOffset = 0;
    let frameStart = this.droppedSamples;
    for (const frame of this.frames) {
      const frameEnd = frameStart + frame.length;
      if (frameEnd <= startSample) {
        frameStart = frameEnd;
        continue;
      }
      if (frameStart >= endSample) break;
      const sliceStart = Math.max(0, startSample - frameStart);
      const sliceEnd = Math.min(frame.length, endSample - frameStart);
      const len = sliceEnd - sliceStart;
      out.set(frame.subarray(sliceStart, sliceEnd), outOffset);
      outOffset += len;
      frameStart = frameEnd;
    }

    return encodeWav(out, SAMPLE_RATE);
  }
}

function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, "WAVE");
  // fmt subchunk (PCM, mono, 16-bit)
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  // data subchunk
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  // Samples
  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
