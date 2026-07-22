"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS } from "@/lib/constants";

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  active: boolean;
  barCount?: number;
  compact?: boolean;
}

type Quality = "silent" | "quiet" | "good" | "strong";

function classifyLevel(level: number): Quality {
  if (level < 4) return "silent";
  if (level < 10) return "quiet";
  if (level < 50) return "good";
  return "strong";
}

/**
 * Real-time audio level meter. Reads the AnalyserNode on every animation
 * frame and renders 14 frequency-binned bars. Shows a "Move closer to the
 * speaker" hint when the average level stays below ~10 for a couple seconds.
 */
export function AudioVisualizer({
  analyser,
  active,
  barCount = 14,
  compact = false,
}: AudioVisualizerProps) {
  const [bars, setBars] = useState<number[]>(() => Array(barCount).fill(0));
  const [level, setLevel] = useState(0);
  const [persistentlyQuiet, setPersistentlyQuiet] = useState(false);
  const quietSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser || !active) {
      setBars(Array(barCount).fill(0));
      setLevel(0);
      setPersistentlyQuiet(false);
      quietSinceRef.current = null;
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);

      // Average level across the full spectrum — used for the overall
      // "quiet / good / strong" classification.
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      setLevel(avg);

      // Bin the spectrum into `barCount` bars (averaged within each bin),
      // focusing on the lower two-thirds where speech lives.
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
      setBars(next);

      // Track how long we've been quiet, so the "move closer" hint only appears
      // after ~4s of sustained silence. A khateeb pauses 2-5s between ayat/
      // sentences; a 1.5s threshold flashed the amber warning on every natural
      // pause even with the phone well-positioned, eroding trust in the signal.
      // A genuinely too-far/covered mic stays quiet well past any normal pause.
      if (avg < 10) {
        if (quietSinceRef.current == null) {
          quietSinceRef.current = performance.now();
        } else if (performance.now() - quietSinceRef.current > 4000) {
          setPersistentlyQuiet(true);
        }
      } else {
        quietSinceRef.current = null;
        setPersistentlyQuiet(false);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [analyser, active, barCount]);

  const quality = classifyLevel(level);
  const barColor =
    quality === "silent" || quality === "quiet"
      ? COLORS.amber
      : quality === "strong"
        ? COLORS.accent
        : COLORS.accent;

  const barMax = compact ? 20 : 56;
  const barMin = compact ? 3 : 4;
  const barWidth = compact ? 3 : 4;
  const barGap = compact ? 3 : 4;
  const containerHeight = compact ? 24 : 64;
  const paddingX = compact ? 12 : 24;

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div
        className="flex items-end justify-center w-full"
        style={{
          height: containerHeight,
          gap: barGap,
          paddingLeft: paddingX,
          paddingRight: paddingX,
        }}
        role="img"
        aria-label={`Audio level: ${quality}`}
      >
        {bars.map((b, i) => {
          const heightPx = Math.max(barMin, Math.min(barMax, (b / 255) * barMax));
          return (
            <div
              key={i}
              className="rounded-full transition-[height,background-color] duration-75"
              style={{
                width: barWidth,
                height: heightPx,
                background: active ? barColor : COLORS.t4,
                opacity: active ? 0.9 : 0.35,
              }}
            />
          );
        })}
      </div>

      {active && persistentlyQuiet && (
        <div
          className="px-3 py-[6px] rounded-lg text-[11px] font-semibold flex items-center gap-2"
          style={{
            background: COLORS.amberSoft,
            border: `1px solid ${COLORS.amber}40`,
            color: COLORS.amber,
          }}
          role="status"
        >
          <span aria-hidden>🎤</span>
          <span>Move closer to the speaker — signal is weak</span>
        </div>
      )}

      {!compact && active && !persistentlyQuiet && quality === "strong" && (
        <div
          className="text-xs font-semibold"
          style={{ color: COLORS.accent }}
        >
          Strong signal
        </div>
      )}
    </div>
  );
}
