"use client";

import { useEffect, useRef, useState } from "react";

interface RotatingTextProps {
  /** Words to cycle through. */
  items: string[];
  /** Time each word is shown, ms. */
  intervalMs?: number;
  className?: string;
}

// Height of one line in `em` (relative to the inherited font size), so the
// component sizes itself to whatever text it sits inside.
const LINE_EM = 1.35;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Fluidly rotates through a list of words with a vertical slot-roll — the same
 * smooth, eased motion as the audio-meter bars. A duplicated first item at the
 * end lets it loop seamlessly (scroll onto the dup, then jump back with no
 * transition). Respects prefers-reduced-motion (shows the first word, static).
 */
export function RotatingText({ items, intervalMs = 2200, className }: RotatingTextProps) {
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [reduce, setReduce] = useState(false);
  const idxRef = useRef(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // One-shot, post-hydration reduced-motion check.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReduce(true);
      return;
    }
    const id = setInterval(() => {
      idxRef.current += 1;
      setAnimate(true);
      setIndex(idxRef.current);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  // Once we've rolled onto the duplicated first item, snap back to 0 with no
  // animation so the loop is invisible.
  const onTransitionEnd = () => {
    if (idxRef.current >= items.length) {
      idxRef.current = 0;
      setAnimate(false);
      setIndex(0);
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    }
  };

  if (reduce || items.length <= 1) {
    return <span className={className}>{items[0]}</span>;
  }

  const list = [...items, items[0]];

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        overflow: "hidden",
        height: `${LINE_EM}em`,
        verticalAlign: "bottom",
      }}
      aria-label={items[0]}
    >
      <span
        onTransitionEnd={onTransitionEnd}
        style={{
          display: "flex",
          flexDirection: "column",
          transform: `translateY(-${index * LINE_EM}em)`,
          transition: animate ? `transform 600ms ${EASE}` : "none",
        }}
      >
        {list.map((w, i) => (
          <span
            key={i}
            aria-hidden={i !== 0}
            style={{
              height: `${LINE_EM}em`,
              lineHeight: `${LINE_EM}em`,
              whiteSpace: "nowrap",
            }}
          >
            {w}
          </span>
        ))}
      </span>
    </span>
  );
}
