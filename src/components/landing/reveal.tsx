"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Stagger delay in ms before this element animates. */
  delay?: number;
  className?: string;
  /**
   * false = transform-only (opacity stays 1). Use for above-the-fold content
   * so a fade-in doesn't delay Largest Contentful Paint. Default true.
   */
  fade?: boolean;
}

/**
 * Reveals its children when they scroll into view (punchy rise + slight scale +
 * gentle overshoot) AND re-hides them when they scroll back out — so the
 * animation reverses on scroll-up. `fade={false}` keeps opacity at 1 (LCP-safe)
 * for above-the-fold content. Respects prefers-reduced-motion (shows instantly,
 * no toggling). Content is only opacity/transform-shifted — never removed from
 * the DOM — so it stays crawlable.
 */
export function Reveal({ children, delay = 0, className, fade = true }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduce(true);
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        // Two-way: shown while in view, hidden when scrolled back out, so the
        // reveal reverses on scroll-up. Kept observing — not a one-shot.
        setShown(entries[0]?.isIntersecting ?? false);
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const smooth = "cubic-bezier(0.22, 1, 0.36, 1)";
  const overshoot = "cubic-bezier(0.34, 1.4, 0.64, 1)"; // slight "pop"

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: fade && !shown ? 0 : 1,
        transform: shown ? "none" : "translateY(28px) scale(0.96)",
        transition: reduce
          ? "none"
          : [
              fade ? `opacity 600ms ${smooth} ${delay}ms` : null,
              `transform 600ms ${overshoot} ${delay}ms`,
            ]
              .filter(Boolean)
              .join(", "),
        willChange: fade ? "opacity, transform" : "transform",
      }}
    >
      {children}
    </div>
  );
}
