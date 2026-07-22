// AudioWorkletProcessor that converts the audio graph's Float32 output to
// signed 16-bit PCM and posts ArrayBuffer frames to the main thread. Fed
// to Deepgram as raw Linear16 (encoding=linear16&sample_rate=16000) so we
// avoid the container framing latency MediaRecorder/WebM-Opus imposes on
// small chunks.
//
// Frame size: 40ms of audio at the context's ACTUAL rate, passed in via
// processorOptions.frameSize (640 @16kHz, 1920 @48kHz). Small enough to keep
// audio-to-transcript latency low; large enough to avoid one-message-per-
// quantum WebSocket spam. Falls back to 640 if not supplied.
//
// Noise gate: frames whose RMS falls below NOISE_GATE_LINEAR (-55 dBFS)
// are zero-filled before posting. Sending zeros instead of dropping keeps
// the WebSocket cadence intact for Deepgram's endpointing logic; Deepgram
// interprets zero-filled frames as clean silence. -55 dBFS sits well below
// even very quiet outdoor PA bleed (~-40 dBFS), so legitimate signal passes
// through unchanged — only true near-silence (gaps between phrases, ambient
// hum after the audio-graph filters) is suppressed.

// 10 ^ (-55 / 20) — RMS threshold in linear amplitude.
const NOISE_GATE_LINEAR = 0.001778;

class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const fs =
      options && options.processorOptions && options.processorOptions.frameSize;
    this.frameSize = typeof fs === "number" && fs > 0 ? Math.round(fs) : 640;
    this.buffer = new Float32Array(this.frameSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i];
      if (this.bufferIndex >= this.frameSize) {
        // RMS of the buffered float frame — drives the gate decision.
        let sumSq = 0;
        for (let j = 0; j < this.frameSize; j++) {
          const s = this.buffer[j];
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / this.frameSize);

        const int16 = new Int16Array(this.frameSize);
        if (rms >= NOISE_GATE_LINEAR) {
          for (let j = 0; j < this.frameSize; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
        }
        // Else: int16 stays zero-filled (Int16Array default). Posted as
        // silence to Deepgram — keeps WS cadence + lets endpointing fire.
        this.port.postMessage(int16.buffer, [int16.buffer]);
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorkletProcessor);
