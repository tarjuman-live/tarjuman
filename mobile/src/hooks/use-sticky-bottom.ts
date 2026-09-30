/**
 * Fluid sticky-bottom scroll — native port of src/hooks/use-sticky-bottom.ts.
 *
 * "Slow is smooth, smooth is fast." Instead of firing `scrollToEnd({animated})`
 * on every update (UIKit's fixed-duration scroll, which RESTARTS each time the
 * interim text changes — the exact stutter the web hook was written to kill),
 * this runs ONE continuous per-frame loop (Reanimated `useFrameCallback`, the
 * UI-thread requestAnimationFrame) that eases the offset toward the bottom.
 * New content only moves the target; the running glide never restarts.
 *
 * Same constants as the web:
 *   EASE = 0.22 of the remaining distance per (60Hz) frame
 *   MIN_STEP = 0.75px floor, SETTLE_EPS = 0.5px snap + stop, threshold 200px
 *   disengage is DIRECTION-based: offset drops > 1px AND > threshold from bottom
 *   re-engage when the user returns within the threshold (or taps the pill)
 *
 * Native-only corrections (documented, not new behaviour):
 *   - Frame-rate normalised: the web applies EASE per rAF tick and iOS Safari
 *     caps rAF at 60Hz, but a ProMotion display runs frame callbacks at 120Hz.
 *     k = 1 − (1 − EASE)^(dt/16.67) keeps the glide the same speed.
 *   - Own-write echo filter: our scrollTo() writes come back as scroll events,
 *     possibly a frame late. A late echo is "lower than the last write" and
 *     would look like a user drag-up, so echoes of our own writes are ignored
 *     (the web reads scrollTop synchronously and never sees a stale value).
 *   - The glide pauses while a finger is on the list (or it is flinging) —
 *     setting contentOffset under an active UIKit drag fights the finger.
 *   - Reduce Motion → jump straight to the bottom (web matchMedia branch).
 *
 * Usage: spread `scrollProps` onto an `Animated.ScrollView` and pass `ref`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import type Animated from "react-native-reanimated";
import {
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { REDUCE_MOTION } from "~/lib/motion";

export const STICKY = {
  /** Fraction of the remaining distance covered per 60Hz frame. */
  ease: 0.22,
  /** px floor per 60Hz frame so the glide always finishes. */
  minStep: 0.75,
  /** px: within this of the bottom, snap and stop. */
  settleEps: 0.5,
  /** Pin threshold (≈ two segments). */
  threshold: 200,
} as const;

const FRAME_MS = 1000 / 60;
/** Frames a fling may keep the glide paused before we assume a lost momentum-end. */
const MOMENTUM_FRAME_CAP = 360;
const OWN_WRITES_CAP = 8;

export interface StickyBottomOptions {
  /** Pinned at mount (live views). `false` for static views that open at the TOP. */
  startStuck?: boolean;
}

export function useStickyBottom(
  threshold: number = STICKY.threshold,
  { startStuck = true }: StickyBottomOptions = {}
) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  // Pinned state: shared value drives the UI-thread loop, state drives the pill.
  const sticky = useSharedValue(startStuck);
  const stickyJS = useRef(startStuck);
  const [isStuck, setIsStuck] = useState(startStuck);

  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  /** Last known offset (our own write, or the last scroll event). */
  const lastTop = useSharedValue(0);
  /** Resting top offset (−adjusted top inset under a transparent header). */
  const restTop = useSharedValue(0);
  const ownWrites = useSharedValue<number[]>([]);
  const dragging = useSharedValue(false);
  const momentum = useSharedValue(false);
  const momentumFrames = useSharedValue(0);

  // Start/stop handshake: JS bumps `gen` on every kick; the loop reports the gen
  // it settled on, and JS only stops it if no newer kick happened meanwhile.
  const gen = useSharedValue(0);
  const reportedGen = useSharedValue(-1);
  const genJS = useRef(0);
  const runningJS = useRef(false);
  const settledRef = useRef<(g: number) => void>(() => {});

  const onSettledJS = useCallback((g: number) => settledRef.current(g), []);

  // Memoised so useFrameCallback doesn't unregister/re-register every render
  // (it re-registers whenever the callback identity changes).
  const onFrame = useCallback((info: FrameInfo) => {
    "worklet";
    if (!sticky.value) return;
    if (dragging.value) return;
    if (momentum.value) {
      momentumFrames.value += 1;
      if (momentumFrames.value < MOMENTUM_FRAME_CAP) return;
      momentum.value = false;
    }
    const target = Math.max(restTop.value, contentH.value - viewH.value);
    const cur = lastTop.value;
    const diff = target - cur;
    const write = (y: number) => {
      const q = ownWrites.value;
      ownWrites.value = q.length >= OWN_WRITES_CAP ? [...q.slice(1), y] : [...q, y];
      lastTop.value = y; // mark our own write so onScroll doesn't read it as a drag
      scrollTo(scrollRef, 0, y, false);
    };
    if (Math.abs(diff) <= STICKY.settleEps || REDUCE_MOTION.value) {
      if (Math.abs(diff) > 0.01) write(target);
      if (reportedGen.value !== gen.value) {
        reportedGen.value = gen.value;
        scheduleOnRN(onSettledJS, gen.value);
      }
      return;
    }
    const dt = Math.min(50, Math.max(1, info.timeSincePreviousFrame ?? FRAME_MS));
    const f = dt / FRAME_MS;
    const k = 1 - Math.pow(1 - STICKY.ease, f);
    const eased = diff * k;
    const minStep = STICKY.minStep * f;
    const step =
      Math.abs(eased) < minStep ? Math.sign(diff) * Math.min(minStep, Math.abs(diff)) : eased;
    write(cur + step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const frame = useFrameCallback(onFrame, false);

  const stop = useCallback(() => {
    runningJS.current = false;
    frame.setActive(false);
  }, [frame]);

  const kick = useCallback(() => {
    if (!stickyJS.current) return;
    genJS.current += 1;
    gen.value = genJS.current;
    if (!runningJS.current) {
      runningJS.current = true;
      frame.setActive(true);
    }
  }, [frame, gen]);

  settledRef.current = (g: number) => {
    if (g === genJS.current && runningJS.current) stop();
  };

  const onUnstickJS = useCallback(() => {
    if (!stickyJS.current) return;
    stickyJS.current = false;
    setIsStuck(false);
    stop();
  }, [stop]);

  const onRestickJS = useCallback(() => {
    if (stickyJS.current) return;
    stickyJS.current = true;
    setIsStuck(true);
    kick();
  }, [kick]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      contentH.value = e.contentSize.height;
      viewH.value = e.layoutMeasurement.height;
      // Echo of our own write (possibly late, possibly after throttled drops).
      const q = ownWrites.value;
      for (let i = 0; i < q.length; i++) {
        if (Math.abs(q[i] - y) < 0.75) {
          ownWrites.value = q.slice(i + 1);
          return;
        }
      }
      const user = dragging.value || momentum.value;
      // System-driven offsets (automatic inset adjustment, status-bar
      // scroll-to-top) reveal the resting top under a transparent header.
      if (!user && y < restTop.value) restTop.value = y;
      const dist = e.contentSize.height - e.layoutMeasurement.height - y;
      const wentUp = y < lastTop.value - 1;
      lastTop.value = y;
      if (wentUp && dist > threshold) {
        // Deliberate scroll up past the threshold — disengage.
        if (sticky.value) {
          sticky.value = false;
          scheduleOnRN(onUnstickJS);
        }
        return;
      }
      if (dist <= threshold && !sticky.value) {
        // Back near the bottom — re-engage the glide.
        sticky.value = true;
        scheduleOnRN(onRestickJS);
      }
    },
    onBeginDrag: () => {
      dragging.value = true;
      momentum.value = false;
      ownWrites.value = [];
    },
    onEndDrag: () => {
      dragging.value = false;
    },
    onMomentumBegin: () => {
      momentum.value = true;
      momentumFrames.value = 0;
    },
    onMomentumEnd: () => {
      momentum.value = false;
    },
  });

  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      contentH.value = h;
      kick();
    },
    [contentH, kick]
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewH.value = e.nativeEvent.layout.height;
      kick();
    },
    [viewH, kick]
  );

  /** Re-pin and glide to the bottom (the pills). Reduce Motion → jump. */
  const scrollToBottom = useCallback(() => {
    sticky.value = true;
    if (!stickyJS.current) {
      stickyJS.current = true;
      setIsStuck(true);
    }
    kick();
  }, [kick, sticky]);

  // Every render: if pinned, make sure the glide is heading to the (possibly
  // new) bottom — the web's per-render useLayoutEffect kick.
  useEffect(() => {
    if (stickyJS.current) kick();
  });

  // (useFrameCallback unregisters the loop on unmount.)

  return {
    scrollRef,
    isStuck,
    scrollToBottom,
    /** Spread onto the Animated.ScrollView. */
    scrollProps: {
      onScroll,
      onContentSizeChange,
      onLayout,
      scrollEventThrottle: 1,
    },
  };
}

/**
 * Static-view variant (web session-body `useStickyBottom(200, { startStuck:
 * false })`): opens at the TOP and only pins once the user scrolls to within
 * `threshold` of the bottom, then glides with any growth below (streamed
 * summary, typewriter). Same engine as the live hook — own-write echo filter,
 * dt-scaled MIN_STEP, and the loop goes idle once settled.
 *
 * Drop-in for the saved-session screen's local copy: same return shape
 * (`ref`, `onScroll`, `onContentSizeChange`, `onLayout`) plus `isStuck` /
 * `scrollToBottom`. Pass `scrollEventThrottle={1}` (or spread `scrollProps`)
 * so the echo filter sees every write.
 */
export function useStaticStickyBottom(threshold: number = STICKY.threshold) {
  const s = useStickyBottom(threshold, { startStuck: false });
  return {
    ref: s.scrollRef,
    onScroll: s.scrollProps.onScroll,
    onContentSizeChange: s.scrollProps.onContentSizeChange,
    onLayout: s.scrollProps.onLayout,
    scrollEventThrottle: s.scrollProps.scrollEventThrottle,
    scrollProps: s.scrollProps,
    isStuck: s.isStuck,
    scrollToBottom: s.scrollToBottom,
  };
}
