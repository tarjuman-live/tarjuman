"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Fluid sticky-bottom scroll, tuned for live-transcription UX.
 *
 * "Slow is smooth, smooth is fast." Instead of firing a fresh native
 * `scrollTo({ behavior: "smooth" })` on every render (which restarts the
 * browser's easing each time and stutters when interim text updates several
 * times a second), this runs ONE continuous requestAnimationFrame loop that
 * eases `scrollTop` toward the bottom every frame. New content just moves the
 * target; the single running loop keeps gliding — no restart-jank.
 *
 * Behavior:
 *   - Default: pinned to the bottom; the loop glides to each new line.
 *   - Wide pin threshold (200px ≈ ~2 segments) so a slight finger movement
 *     won't pop you out.
 *   - Disengage is DIRECTION-based: the loop only ever moves toward the bottom
 *     (monotonic when content grows), so a `scrollTop` that DROPS past the
 *     threshold can only be the user dragging up — that unpins. No fragile
 *     "is this my own scroll?" flag.
 *   - `prefers-reduced-motion: reduce` → jump instantly (no animation).
 *   - Exposes `isStuck` + `scrollToBottom` so the caller can render a
 *     "↓ new" pill that re-engages the glide on tap.
 */

const EASE = 0.22; // fraction of remaining distance covered per frame
const MIN_STEP = 0.75; // px floor so the glide always finishes (no sub-pixel crawl)
const SETTLE_EPS = 0.5; // px: within this of the bottom, snap and stop the loop

export function useStickyBottom<T extends HTMLElement = HTMLDivElement>(
  threshold = 200,
  { startStuck = true }: { startStuck?: boolean } = {}
) {
  const scrollRef = useRef<T | null>(null);
  // Whether the user is pinned to the bottom. Ref drives the loop; state drives
  // the caller's "scroll to latest" UI. `startStuck=false` is for STATIC views
  // (a completed/saved session) that should open at the TOP — otherwise the
  // mount layout-effect + ResizeObserver glide straight to the bottom of the
  // transcript, hiding the summary and the Generate-Summary CTA above it.
  const stickyRef = useRef(startStuck);
  const [isStuck, setIsStuck] = useState(startStuck);

  const lastTopRef = useRef(0); // last known scrollTop (to tell a user-up apart from our glide)
  const runningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const reduceRef = useRef(false);

  // Detect (and track) the reduced-motion preference client-side.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const onChange = () => {
      reduceRef.current = mq.matches;
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const kick = useCallback(() => {
    if (!stickyRef.current || runningRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    if (reduceRef.current) {
      const target = el.scrollHeight - el.clientHeight;
      el.scrollTop = target;
      lastTopRef.current = target;
      return;
    }
    runningRef.current = true;
    // Function declaration (hoisted) so it can reschedule itself.
    function frame() {
      const node = scrollRef.current;
      if (!node || !stickyRef.current) {
        runningRef.current = false;
        rafRef.current = null;
        return;
      }
      const target = node.scrollHeight - node.clientHeight;
      const cur = node.scrollTop;
      const diff = target - cur;
      if (Math.abs(diff) <= SETTLE_EPS || reduceRef.current) {
        node.scrollTop = target;
        lastTopRef.current = target;
        runningRef.current = false;
        rafRef.current = null;
        return;
      }
      const eased = diff * EASE;
      const step =
        Math.abs(eased) < MIN_STEP
          ? Math.sign(diff) * Math.min(MIN_STEP, Math.abs(diff))
          : eased;
      const next = cur + step;
      node.scrollTop = next;
      lastTopRef.current = next; // mark our own write so onScroll doesn't read it as a user drag
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const st = el.scrollTop;
    const dist = el.scrollHeight - el.clientHeight - st;
    const wentUp = st < lastTopRef.current - 1;
    lastTopRef.current = st;
    if (wentUp && dist > threshold) {
      // User deliberately scrolled up past the threshold — disengage.
      if (stickyRef.current) {
        stickyRef.current = false;
        setIsStuck(false);
        stop();
      }
      return;
    }
    if (dist <= threshold && !stickyRef.current) {
      // User scrolled back to the bottom — re-engage the glide.
      stickyRef.current = true;
      setIsStuck(true);
      kick();
    }
  }, [threshold, stop, kick]);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      stickyRef.current = true;
      setIsStuck(true);
      if (smooth && !reduceRef.current) {
        kick();
      } else {
        const target = el.scrollHeight - el.clientHeight;
        el.scrollTop = target;
        lastTopRef.current = target;
      }
    },
    [kick]
  );

  // Every render: if pinned, ensure the glide is heading to the (possibly new)
  // bottom. kick() no-ops if already running — cheap.
  useLayoutEffect(() => {
    if (stickyRef.current) kick();
  });

  // Re-kick when the scroll element or its content resizes (new card mounts,
  // mobile keyboard opens, etc.).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      if (stickyRef.current) kick();
    });
    obs.observe(el);
    const inner = el.firstElementChild;
    if (inner) obs.observe(inner);
    return () => obs.disconnect();
  }, [kick]);

  // Stop the loop on unmount.
  useEffect(() => () => stop(), [stop]);

  return {
    scrollRef,
    onScroll,
    isStuck,
    scrollToBottom,
  };
}
