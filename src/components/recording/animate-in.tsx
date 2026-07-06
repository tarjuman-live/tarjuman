"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { animate } from "animejs";

/**
 * anime.js entrance for a transcript / translation message. Each message rises
 * + fades + un-blurs into place the moment it mounts (a new final segment, or a
 * translation landing), so the live transcript feels alive instead of popping.
 *
 * CRITICAL-PATH SAFETY: the transcript must NEVER be left invisible. So:
 *  - reduced-motion → show instantly, no animation;
 *  - the animate() call is wrapped in try/catch, and on ANY failure we force
 *    the element fully visible;
 *  - anime.js is statically imported (bundled), so `animate` is always present
 *    at runtime — no dynamic-load failure mode.
 * The element starts at opacity:0 only for the sub-frame before the mount
 * effect runs; if that effect somehow never runs, a normally-mounted client
 * component doesn't hit this path.
 */
export function AnimateIn({
  children,
  className,
  style,
  variant = "source",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Slightly different motion for the source vs its translation. */
  variant?: "source" | "translation";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }

    try {
      // opacity is what guarantees visibility — kept dead-simple. translateY +
      // a whisper of scale give the premium "rise into place" feel.
      animate(el, {
        opacity: [0, 1],
        translateY: variant === "source" ? [14, 0] : [10, 0],
        scale: variant === "source" ? [0.985, 1] : [1, 1],
        duration: variant === "source" ? 620 : 520,
        ease: "out(3)",
      });
    } catch {
      // Animation failed — never leave the message hidden.
      el.style.opacity = "1";
      el.style.transform = "none";
    }
  }, [variant]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ opacity: 0, willChange: "opacity, transform", ...style }}
    >
      {children}
    </div>
  );
}
