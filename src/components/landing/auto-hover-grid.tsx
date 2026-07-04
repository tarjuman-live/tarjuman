"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Mobile can't hover a cursor, so the cards' hover animations (lift + green
 * outline + glow) never play. This wrapper fixes that on TOUCH devices: it
 * watches its `[data-hovercard]` children with an IntersectionObserver and
 * toggles the `.touch-hover` class as each card becomes prominently visible, so
 * the animation plays automatically while you scroll. Desktop is untouched — it
 * uses real `:hover` (the effect is gated behind `@media (hover: none)` in CSS).
 *
 * Server-rendered children pass straight through; only the observer is client.
 */
export function AutoHoverGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only touch devices (no hover); respect reduced motion.
    if (window.matchMedia("(hover: hover)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = ref.current;
    if (!root) return;
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>("[data-hovercard]")
    );
    if (!cards.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          (e.target as HTMLElement).classList.toggle(
            "touch-hover",
            e.isIntersecting && e.intersectionRatio >= 0.6
          );
        }
      },
      // Fire when a card is ~60% within a slightly-inset viewport, so the
      // active card is the one you're actually looking at as you scroll.
      { threshold: [0, 0.6, 1], rootMargin: "-12% 0px -12% 0px" }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
