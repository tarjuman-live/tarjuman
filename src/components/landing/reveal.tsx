"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Stagger delay in ms before this element animates. */
  delay?: number;
  className?: string;
  /**
   * false = transform-only (opacity stays 1). Use for above-the-fold content
   * so a fade-in doesn't delay Largest Contentful Paint. Default true
   * (fade + slide) — fine for below-the-fold scroll reveals.
   */
  fade?: boolean;
}

/**
 * Reveals its children the first time they scroll into view. Above-the-fold
 * content (with `fade={false}`) animates on load without an opacity fade so it
 * doesn't push out LCP. Respects prefers-reduced-motion (shows instantly, no
 * transition). Content is only opacity/transform-shifted — never removed from
 * the DOM — so it stays crawlable for SEO.
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
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: fade && !shown ? 0 : 1,
        transform: shown ? "none" : "translateY(18px)",
        transition: reduce
          ? "none"
          : [
              fade ? `opacity 650ms ${ease} ${delay}ms` : null,
              `transform 650ms ${ease} ${delay}ms`,
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
