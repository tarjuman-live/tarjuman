"use client";

import { useEffect, useState } from "react";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

/**
 * Lively loading state for AI summary generation.
 *
 * Summaries run on Sonnet 5 for quality, one-shot and streamed. On a long dars
 * (the core use case) the model can take several seconds to first token — and
 * a lone spinning circle over that window reads as "frozen/broken." This shows
 * a skeleton summary forming plus a caption that rotates through the real work
 * (reading → finding points → drafting), so the wait reads as progress. The
 * moment the first characters stream, SessionBody flips to the `ready` phase
 * and this unmounts. Citation verification runs later (once text is on screen),
 * so it's intentionally not claimed here.
 *
 * Motion is CSS-gated by prefers-reduced-motion (shimmer + fade off); caption
 * rotation also holds on the first line for reduced-motion users.
 */
const CAPTIONS = [
  "Reading the transcript…",
  "Finding the key points…",
  "Writing your summary…",
];

const ROTATE_MS = 2200;

export function SummaryLoading() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return; // hold on the first caption, no rotation
    }
    const id = setInterval(
      () => setI((n) => (n + 1) % CAPTIONS.length),
      ROTATE_MS
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="px-4 py-4 rounded-2xl mb-5"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.accent}30`,
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon name="sparkle" size={14} color={COLORS.accent} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: COLORS.accent }}
        >
          Summarizing
        </span>
      </div>

      {/* Rotating caption — keyed so it re-fades on each change. */}
      <div
        key={i}
        className="summary-caption text-sm mb-4"
        style={{ color: COLORS.t2 }}
      >
        {CAPTIONS[i]}
      </div>

      {/* Skeleton lines mimicking a summary forming. */}
      <div className="space-y-2.5" aria-hidden="true">
        <div className="summary-shimmer-bar h-3" style={{ width: "38%" }} />
        <div className="summary-shimmer-bar h-2.5" style={{ width: "92%" }} />
        <div className="summary-shimmer-bar h-2.5" style={{ width: "80%" }} />
        <div className="summary-shimmer-bar h-2.5" style={{ width: "88%" }} />
        <div className="summary-shimmer-bar h-2.5" style={{ width: "58%" }} />
      </div>
    </div>
  );
}
