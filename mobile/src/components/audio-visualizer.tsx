/**
 * AudioVisualizer — port of src/components/recording/audio-visualizer.tsx.
 *
 * Functional, not decorative (CLAUDE.md #12): real spectrum bars and a
 * "move closer" prompt so nobody sits through a 30-minute lecture only to find
 * the transcript is empty.
 *
 * WEB → NATIVE
 *   - Web reads AnalyserNode.getByteFrequencyData (fftSize 256, smoothing .6,
 *     min/max dB −100/−30) every animation frame. Native has no analyser on the
 *     capture path, so `ByteSpectrum` below re-implements getByteFrequencyData
 *     to the Web Audio spec (Blackman window → 256-pt FFT → |X|/N → temporal
 *     smoothing → dB → byte) over the recorder's processed samples from
 *     recorder.subscribeMeter — the SAME tap point as the web analyser (after
 *     the gain stage, BEFORE the -55 dBFS noise gate), so room tone / a soft
 *     PA between phrases reads as live signal exactly as on the web, not as
 *     gated zeros. Input is resampled to 16 kHz (the web AudioContext rate) so
 *     the bins — and the "lower two-thirds" speech band — cover the same Hz.
 *     Cadence matches the web's per-frame read: the resampled stream is cut
 *     into 60 Hz hops (16000/60 ≈ 266.7 samples — what one web rAF spans) and
 *     ONE spectrum is taken per hop over the latest 256 samples, with the
 *     analyser's smoothing (.6) applied once per hop, exactly as the web
 *     applies it once per frame. A 40 ms native buffer yields ~2.4 hops, so
 *     all of its audio is analysed (not just the last 256 samples). The hop
 *     results are queued with due times spread across the buffer's real-time
 *     span and a requestAnimationFrame loop drains them — ~60 retargets/s,
 *     one buffer (≤40 ms) behind the mic.
 *   - Bars: height clamp(barMin, band/255·barMax, barMax), tweened 75 ms
 *     bezier(.4,0,.2,1) (Tailwind `transition-[height,background-color]
 *     duration-75`). Colour: amber while avg < 10, accent otherwise, same 75 ms.
 *   - Inactive (paused): bars glide to barMin + grey t4 over 75 ms; opacity
 *     snaps .9 → .35 (opacity is not in the web's transition list).
 *   - Hint: only after > 4000 ms of continuous avg < 10 (a khateeb pauses 2-5 s
 *     between ayat). The web mounts/unmounts it instantly; per the house
 *     "everything fluid" rule it fades 150 ms in/out here (tw-animate default).
 *   Bands live in a SharedValue — no React render per frame.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { C } from "~/lib/theme";
import { EASE, TW_ENTER, TW_EXIT } from "~/lib/motion";
import { useT } from "~/i18n";
import type { NativeRecorder } from "~/hooks/use-native-recorder";

// ─── getByteFrequencyData, per the Web Audio spec ─────────────────────────────

const FFT_SIZE = 256; // lib/audio-processor.ts analyser.fftSize
const BIN_COUNT = FFT_SIZE / 2;
const SMOOTHING = 0.6; // analyser.smoothingTimeConstant, applied once per web rAF
const METER_RATE = 16000; // web AudioContext({ sampleRate: 16000 })
/** Samples one web animation frame spans at METER_RATE (60 Hz rAF). */
const HOP = METER_RATE / 60;
const MIN_DB = -100; // AnalyserNode defaults
const MAX_DB = -30;

class ByteSpectrum {
  private win = new Float32Array(FFT_SIZE);
  private hist = new Float32Array(FFT_SIZE);
  private re = new Float64Array(FFT_SIZE);
  private im = new Float64Array(FFT_SIZE);
  private cos = new Float64Array(FFT_SIZE / 2);
  private sin = new Float64Array(FFT_SIZE / 2);
  private rev = new Uint16Array(FFT_SIZE);
  private smooth = new Float32Array(BIN_COUNT);
  readonly bytes = new Uint8Array(BIN_COUNT);

  constructor() {
    const N = FFT_SIZE;
    // Blackman window (alpha .16) — the spec's analyser window.
    for (let i = 0; i < N; i++) {
      this.win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
    }
    for (let i = 0; i < N / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / N);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / N);
    }
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  // Linear-interpolating resampler state (input rate → METER_RATE).
  private rs = new Float32Array(0);
  private rsPos = 0; // fractional read position into the current input
  private rsPrev = 0; // last input sample of the previous buffer

  // Hop clock: samples consumed since reset, and where the next hop lands.
  private count = 0;
  private nextHop = HOP;

  reset() {
    this.hist.fill(0);
    this.smooth.fill(0);
    this.bytes.fill(0);
    this.rsPos = 0;
    this.rsPrev = 0;
    this.count = 0;
    this.nextHop = HOP;
  }

  /** Slide `len` samples of `src` (from `start`) into the 256-sample window. */
  private append(src: Float32Array, start: number, len: number) {
    const N = FFT_SIZE;
    if (len >= N) {
      for (let i = 0; i < N; i++) this.hist[i] = src[start + len - N + i];
    } else {
      this.hist.copyWithin(0, len);
      for (let i = 0; i < len; i++) this.hist[N - len + i] = src[start + i];
    }
  }

  /** Resample one buffer to METER_RATE, continuous across buffers. */
  private resample(input: Float32Array, rate: number): Float32Array {
    if (rate === METER_RATE || !(rate > 0)) return input;
    const step = rate / METER_RATE;
    const maxOut = Math.ceil(input.length / step) + 1;
    if (this.rs.length < maxOut) this.rs = new Float32Array(maxOut);
    let o = 0;
    let pos = this.rsPos;
    // pos is relative to input[0]; pos in [-1, 0) interpolates from rsPrev.
    while (pos < input.length - 1) {
      const i = Math.floor(pos);
      const f = pos - i;
      const a = i < 0 ? this.rsPrev : input[i];
      const b = input[i + 1];
      this.rs[o++] = a + (b - a) * f;
      pos += step;
    }
    this.rsPos = pos - input.length;
    this.rsPrev = input.length ? input[input.length - 1] : this.rsPrev;
    return this.rs.subarray(0, o);
  }

  /**
   * Feed one pre-gate Float32 buffer. Calls `emit(bytes, at)` once per 60 Hz
   * hop completed inside it, where `at` ∈ (0, 1] is how far through the
   * buffer that hop ends. `bytes` is reused — copy what you need.
   */
  push(input: Float32Array, rate: number, emit: (bytes: Uint8Array, at: number) => void) {
    const frame = this.resample(input, rate);
    const n = frame.length;
    let i = 0;
    while (i < n) {
      const take = Math.min(Math.max(1, Math.ceil(this.nextHop - this.count)), n - i);
      this.append(frame, i, take);
      i += take;
      this.count += take;
      if (this.count >= this.nextHop) {
        this.nextHop += HOP;
        this.analyse();
        emit(this.bytes, i / n);
      }
    }
    // Keep the clock small on long sessions (float precision).
    if (this.count > 1e9) {
      this.nextHop -= this.count;
      this.count = 0;
    }
  }

  /** getByteFrequencyData over the current window; smoothing once (one rAF). */
  private analyse() {
    const N = FFT_SIZE;
    const kSmooth = SMOOTHING;
    const { re, im, rev, win } = this;
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      re[j] = this.hist[i] * win[i];
      im[j] = 0;
    }
    // Iterative radix-2 FFT.
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step];
          const s = this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const scale = 255 / (MAX_DB - MIN_DB);
    for (let k = 0; k < BIN_COUNT; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
      const sm = kSmooth * this.smooth[k] + (1 - kSmooth) * mag;
      this.smooth[k] = Number.isFinite(sm) ? sm : 0;
      const db = this.smooth[k] > 0 ? 20 * Math.log10(this.smooth[k]) : -Infinity;
      const v = Math.floor(scale * (db - MIN_DB));
      this.bytes[k] = v <= 0 ? 0 : v >= 255 ? 255 : v;
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

type Quality = "silent" | "quiet" | "good" | "strong";
function classifyLevel(level: number): Quality {
  if (level < 4) return "silent";
  if (level < 10) return "quiet";
  if (level < 50) return "good";
  return "strong";
}

const BAR_T = { duration: 75, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
const QUIET_HOLD_MS = 4000;
/** ~0.5 s of hops; older ones are dropped if the frame loop stalls. */
const MAX_QUEUE = 32;

/** One 60 Hz hop's analysis, waiting for its frame. */
interface Hop {
  due: number;
  avg: number;
  bands: number[];
}

export interface AudioVisualizerProps {
  /**
   * recorder.subscribeMeter — pre-noise-gate processed samples (the web
   * AnalyserNode's tap point). Only consumed while `active`.
   */
  subscribe: NativeRecorder["subscribeMeter"];
  /** Web `active` = session running AND not paused. */
  active: boolean;
  barCount?: number;
  compact?: boolean;
}

export function AudioVisualizer({ subscribe, active, barCount = 14, compact = false }: AudioVisualizerProps) {
  const t = useT();
  const bands = useSharedValue<number[]>(Array(barCount).fill(0));
  // 0 = amber (silent/quiet), 1 = accent (good/strong)
  const good = useSharedValue(0);
  // 0 = active colour, 1 = inactive grey t4
  const idle = useSharedValue(active ? 0 : 1);
  const [quality, setQuality] = useState<Quality>("silent");
  const [persistentlyQuiet, setPersistentlyQuiet] = useState(false);

  const spectrumRef = useRef<ByteSpectrum | null>(null);
  const quietSinceRef = useRef<number | null>(null);
  const goodRef = useRef(false);
  const qualityRef = useRef<Quality>("silent");
  const hintRef = useRef(false);

  const barMax = compact ? 20 : 56;
  const barMin = compact ? 3 : 4;
  const barWidth = compact ? 3 : 4;
  const barGap = compact ? 3 : 4;
  const containerHeight = compact ? 24 : 64;
  const paddingX = compact ? 12 : 24;

  useEffect(() => {
    idle.value = withTiming(active ? 0 : 1, BAR_T);
    if (!active) {
      bands.value = Array(barCount).fill(0);
      spectrumRef.current?.reset();
      quietSinceRef.current = null;
      hintRef.current = false;
      setPersistentlyQuiet(false);
      qualityRef.current = "silent";
      setQuality("silent");
      return;
    }
    const spec = (spectrumRef.current ??= new ByteSpectrum());
    spec.reset();

    // One web animation frame's worth of work for one hop's spectrum.
    const apply = (e: Hop) => {
      const q = classifyLevel(e.avg);
      if (q !== qualityRef.current) {
        qualityRef.current = q;
        setQuality(q);
      }
      const isGood = e.avg >= 10;
      if (isGood !== goodRef.current) {
        goodRef.current = isGood;
        good.value = withTiming(isGood ? 1 : 0, BAR_T);
      }

      let hint = hintRef.current;
      if (e.avg < 10) {
        if (quietSinceRef.current == null) quietSinceRef.current = e.due;
        else if (e.due - quietSinceRef.current > QUIET_HOLD_MS) hint = true;
      } else {
        quietSinceRef.current = null;
        hint = false;
      }
      if (hint !== hintRef.current) {
        hintRef.current = hint;
        setPersistentlyQuiet(hint);
      }
    };

    // Hop spectra waiting for their frame, oldest first.
    const queue: Hop[] = [];
    let raf = 0;
    const drain = () => {
      const now = performance.now();
      let latest: Hop | null = null;
      while (queue.length && queue[0].due <= now) {
        const e = queue.shift()!;
        apply(e);
        latest = e;
      }
      if (latest) bands.value = latest.bands;
      raf = requestAnimationFrame(drain);
    };
    raf = requestAnimationFrame(drain);

    const unsubscribe = subscribe((samples, rate) => {
      const arrived = performance.now();
      const spanMs = rate > 0 ? (samples.length / rate) * 1000 : 0;
      spec.push(samples, rate, (data, at) => {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;

        // Lower two-thirds of the spectrum, where speech lives.
        const speechBins = Math.floor((data.length * 2) / 3);
        const step = Math.max(1, Math.floor(speechBins / barCount));
        const next: number[] = [];
        for (let i = 0; i < barCount; i++) {
          let s = 0;
          let n = 0;
          for (let j = i * step; j < (i + 1) * step && j < speechBins; j++) {
            s += data[j];
            n++;
          }
          next.push(n > 0 ? s / n : 0);
        }
        // Spread across the buffer's real-time span: the hop that ends `at`
        // of the way through it shows `at · span` after the buffer arrived.
        queue.push({ due: arrived + at * spanMs, avg, bands: next });
      });
      // Never let a stalled frame loop (backgrounded) pile up work.
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      queue.length = 0;
    };
  }, [active, subscribe, barCount, bands, good, idle]);

  return (
    <View style={styles.wrap}>
      <View
        style={[styles.bars, { height: containerHeight, gap: barGap, paddingHorizontal: paddingX }]}
        accessibilityRole="image"
        accessibilityLabel={t("record.audioLevel", { quality })}
      >
        {Array.from({ length: barCount }, (_, i) => (
          <Bar
            key={i}
            index={i}
            bands={bands}
            good={good}
            idle={idle}
            min={barMin}
            max={barMax}
            width={barWidth}
            opacity={active ? 0.9 : 0.35}
          />
        ))}
      </View>

      {active && persistentlyQuiet ? (
        <Animated.View entering={TW_ENTER.fade} exiting={TW_EXIT.fade} style={styles.hint} accessibilityRole="alert">
          <Text style={styles.hintText}>🎤</Text>
          <Text style={styles.hintText}>{t("record.moveCloser")}</Text>
        </Animated.View>
      ) : null}

      {!compact && active && !persistentlyQuiet && quality === "strong" ? (
        <Text style={styles.strong}>{t("record.strongSignal")}</Text>
      ) : null}
    </View>
  );
}

function Bar({
  index,
  bands,
  good,
  idle,
  min,
  max,
  width,
  opacity,
}: {
  index: number;
  bands: SharedValue<number[]>;
  good: SharedValue<number>;
  idle: SharedValue<number>;
  min: number;
  max: number;
  width: number;
  opacity: number;
}) {
  const style = useAnimatedStyle(() => {
    const b = bands.value[index] ?? 0;
    const h = Math.max(min, Math.min(max, (b / 255) * max));
    const live = interpolateColor(good.value, [0, 1], [C.amber, C.accent]);
    return {
      height: withTiming(h, BAR_T),
      backgroundColor: interpolateColor(idle.value, [0, 1], [live, C.t4]),
    };
  });
  return <Animated.View style={[{ width, borderRadius: width / 2, opacity }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 8, width: "100%" },
  bars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", width: "100%" },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.amberSoft,
    borderWidth: 1,
    borderColor: `${C.amber}40`,
  },
  hintText: { color: C.amber, fontSize: 11, fontWeight: "600" },
  strong: { color: C.accent, fontSize: 12, fontWeight: "600" },
});
