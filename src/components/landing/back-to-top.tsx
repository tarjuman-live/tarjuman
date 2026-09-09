"use client";

import { useCallback } from "react";
import { ArrowUp } from "lucide-react";
import { useLenis } from "lenis/react";
import { T } from "./t";

/**
 * "Back to top" — the FAQ is the last section before the footer, so from here
 * the only way back to the hero is a very long scroll.
 *
 * The scroll MUST go through Lenis when it is mounted. Lenis drives
 * window.scrollY from its own rAF loop, so a native `window.scrollTo` would be
 * overridden on the very next frame and land somewhere arbitrary. `useLenis()`
 * reads the root store that <SmoothScroll> populates (it resolves outside the
 * <ReactLenis> subtree, which is why this works from a sibling section), and
 * returns undefined when SmoothScroll didn't mount — i.e. exactly the
 * reduced-motion case, where the native path is correct and jumps instantly
 * rather than animating.
 */
export function BackToTop() {
  const lenis = useLenis();

  const toTop = useCallback(() => {
    if (lenis) {
      lenis.scrollTo(0, { duration: 1.1 });
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [lenis]);

  return (
    <div className="mt-12 flex justify-center">
      <button
        type="button"
        onClick={toTop}
        className="group inline-flex items-center gap-2 rounded-full border border-[var(--color-border-light)] bg-[var(--color-surface)] px-5 py-3 text-sm font-semibold text-[var(--color-text-2)] cursor-pointer transition duration-300 hover:-translate-y-0.5 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:text-[var(--color-text-1)] hover:shadow-[0_10px_30px_rgba(46,204,113,0.18)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <ArrowUp
          aria-hidden
          className="w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        />
        <T k="lp.backToTop" />
      </button>
    </div>
  );
}
