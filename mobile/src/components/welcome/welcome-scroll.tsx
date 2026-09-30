/**
 * Welcome-screen scroll controller — the native form of the landing page's
 * Lenis (src/components/landing/smooth-scroll.tsx) PROGRAMMATIC scrolls.
 *
 * What Lenis does on the web, and what this reproduces frame-for-frame:
 *   - Anchor jumps ("See how it works" → #features, nav section links):
 *     `lenis.scrollTo(hash, { offset: -80 })` in LERP mode (lerp 0.12, no
 *     duration). NOTE the live landing: Lenis 1.3.26's element-target branch
 *     ALSO subtracts the root's computed `scroll-padding-top` (globals.css
 *     `html { scroll-padding-top: 5rem }`), then adds the -80 offset on top,
 *     so the web actually lands a section 160px below the viewport top (a 92px
 *     gap under the 68px header). Reproduced as-is; see WEB_LERP_ANCHOR_OFFSET. Every frame: value = lerp(value, to, 1 − e^(−0.12·60·dt)),
 *     i.e. exponential damping at λ = 7.2/s, finishing when
 *     Math.round(value) === Math.round(to).
 *   - Back to top: `lenis.scrollTo(0, { duration: 1.1 })` in DURATION mode
 *     with Lenis' default easing t ↦ min(1, 1.001 − 2^(−10t)) (expo-out).
 *   - Targets are clamped to [0, maxScroll] like Lenis' `limit`.
 *   - The user's finger wins: a drag cancels any running scroll.
 *   - Reduce Motion: Lenis is NOT mounted, so the browser jumps instantly
 *     (anchor jumps honour only `scroll-padding-top: 5rem` → 80px).
 *
 * What it deliberately does NOT do: smooth the user's own scrolling. Lenis
 * only smooths mouse-wheel input (`syncTouch: false`), so phones get native
 * momentum on the web — which is exactly a plain UIScrollView here.
 *
 * Wiring (see app/welcome.tsx):
 *   const scroller = useWelcomeScrollerState(navBottom);
 *   <WelcomeScrollProvider value={scroller}>
 *     <RevealScrollView onScrollBeginDrag={scroller.cancel} onLayout=… onContentSizeChange=…>
 *       …sections (setSection on layout)…
 *       <WelcomeScrollDriver />         // must be INSIDE the RevealScrollView
 *     </RevealScrollView>
 *     <WelcomeNav />                    // outside — reads scroller.scrollY
 *   </WelcomeScrollProvider>
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useRevealScroll, type RevealScrollContext } from "~/components/motion/reveal";
import { useReduceMotion } from "~/lib/motion";

export type WelcomeSectionId = "features" | "useCases" | "faq";

/** smooth-scroll.tsx `lerp: 0.12` → damping λ = 0.12 × 60 per second. */
const LENIS_DAMPING = 0.12 * 60;
/** back-to-top.tsx `lenis.scrollTo(0, { duration: 1.1 })`. */
const TO_TOP_DURATION_S = 1.1;
/**
 * Where an anchor jump lands the section top, measured from the viewport top
 * (where the web's 68px sticky nav sits).
 *
 * LERP (Lenis mounted): 160 = smooth-scroll.tsx `anchors: { offset: -80 }`
 * PLUS html `scroll-padding-top: 5rem` (80), which Lenis 1.3.26's scrollTo
 * subtracts for element targets (lenis.mjs: `rect.top + animatedScroll -
 * scrollMargin - scrollPadding`, then `+= offset`). That double count is live
 * web behaviour; if the web is fixed (drop the anchors offset, or the
 * scroll-padding), set this back to 80.
 *
 * INSTANT (Reduce Motion — Lenis unmounted, native hash jump): 80 = only the
 * scroll-padding-top.
 */
const WEB_LERP_ANCHOR_OFFSET = 160;
const WEB_INSTANT_ANCHOR_OFFSET = 80;
const WEB_NAV_BOTTOM = 68; // header pt-3 (12) + h-14 (56)

/** Scroll modes. */
const IDLE = 0;
const LERP = 1;
const DURATION = 2;
const INSTANT = 3;

export interface WelcomeScroller {
  /** Mirror of the ScrollView's contentOffset.y (usable OUTSIDE the ScrollView, e.g. the floating nav). */
  scrollY: SharedValue<number>;
  /** Record a section's content-space y (from its onLayout). */
  setSection: (id: WelcomeSectionId, y: number) => void;
  /** Lenis anchor jump (lerp) to a section, leaving the live web's gap below the nav (92px; 12px under Reduce Motion). */
  scrollToSection: (id: WelcomeSectionId) => void;
  /** Lenis duration scroll to the very top (1.1s expo-out). */
  scrollToTop: () => void;
  /**
   * Instant jump to the top (no easing) — a same-page <Link href="/"> on the
   * web, which Lenis does not intercept; Next's layout-router sets
   * scrollTop = 0 directly. Used by the nav brand.
   */
  jumpToTop: () => void;
  /** Stop any programmatic scroll (the user started dragging). */
  cancel: () => void;
  setViewportHeight: (h: number) => void;
  setContentHeight: (h: number) => void;
  /** @internal — shared with the driver. */
  _s: DriverState;
}

interface DriverState {
  mode: SharedValue<number>;
  pending: SharedValue<number>;
  target: SharedValue<number>;
  from: SharedValue<number>;
  cur: SharedValue<number>;
  elapsed: SharedValue<number>;
  maxY: SharedValue<number>;
  viewportH: SharedValue<number>;
  contentH: SharedValue<number>;
  /** Driver's frame-callback switch (set by <WelcomeScrollDriver>). */
  activate: { current: ((on: boolean) => void) | null };
}

const Ctx = createContext<WelcomeScroller | null>(null);

export function WelcomeScrollProvider({ value, children }: { value: WelcomeScroller; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The Welcome scroller (null outside the Welcome screen). */
export function useWelcomeScroll(): WelcomeScroller | null {
  return useContext(Ctx);
}

/**
 * Creates the controller. `navBottom` = where the floating nav island ends
 * (safe-area top + 68, the web's 12px top gap + 56px bar), so anchor jumps land
 * the same distance below it as the web lands below its 68px header: 92px in
 * the Lenis LERP path (160 − 68), 12px on the Reduce Motion instant jump (80 − 68).
 */
export function useWelcomeScrollerState(navBottom: number): WelcomeScroller {
  const reduce = useReduceMotion();
  const scrollY = useSharedValue(0);
  const mode = useSharedValue(IDLE);
  const pending = useSharedValue(0);
  const target = useSharedValue(0);
  const from = useSharedValue(0);
  const cur = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const maxY = useSharedValue(Number.MAX_SAFE_INTEGER);
  const viewportH = useSharedValue(0);
  const contentH = useSharedValue(0);
  const activate = useRef<((on: boolean) => void) | null>(null);
  const sections = useRef<Partial<Record<WelcomeSectionId, number>>>({});

  const recomputeMax = useCallback(() => {
    if (viewportH.value > 0 && contentH.value > 0) {
      maxY.value = Math.max(0, contentH.value - viewportH.value);
    }
  }, [viewportH, contentH, maxY]);

  const start = useCallback(
    (m: number, y: number) => {
      target.value = y;
      mode.value = m;
      pending.value = 1;
      activate.current?.(true);
    },
    [target, mode, pending]
  );

  const setSection = useCallback((id: WelcomeSectionId, y: number) => {
    sections.current[id] = y;
  }, []);

  // Lenis measures the target at click time, so a section laid out later (the
  // live demo growing, a FAQ row opening) still lands correctly.
  const anchorOffset = navBottom + ((reduce ? WEB_INSTANT_ANCHOR_OFFSET : WEB_LERP_ANCHOR_OFFSET) - WEB_NAV_BOTTOM);
  const scrollToSection = useCallback(
    (id: WelcomeSectionId) => {
      const y = sections.current[id];
      if (y === undefined) return;
      start(reduce ? INSTANT : LERP, Math.max(0, y - anchorOffset));
    },
    [start, reduce, anchorOffset]
  );

  const scrollToTop = useCallback(() => start(reduce ? INSTANT : DURATION, 0), [start, reduce]);
  const jumpToTop = useCallback(() => start(INSTANT, 0), [start]);

  const cancel = useCallback(() => {
    mode.value = IDLE;
    pending.value = 0;
    activate.current?.(false);
  }, [mode, pending]);

  const setViewportHeight = useCallback(
    (h: number) => {
      viewportH.value = h;
      recomputeMax();
    },
    [viewportH, recomputeMax]
  );
  const setContentHeight = useCallback(
    (h: number) => {
      contentH.value = h;
      recomputeMax();
    },
    [contentH, recomputeMax]
  );

  return useMemo(
    () => ({
      scrollY,
      setSection,
      scrollToSection,
      scrollToTop,
      jumpToTop,
      cancel,
      setViewportHeight,
      setContentHeight,
      _s: { mode, pending, target, from, cur, elapsed, maxY, viewportH, contentH, activate },
    }),
    [scrollY, setSection, scrollToSection, scrollToTop, jumpToTop, cancel, setViewportHeight, setContentHeight, mode, pending, target, from, cur, elapsed, maxY, viewportH, contentH]
  );
}

/**
 * Lives INSIDE the RevealScrollView (it needs the scroll ref): mirrors the
 * offset out to the controller and runs the per-frame Lenis integrator.
 * Renders nothing.
 */
export function WelcomeScrollDriver() {
  const ctx = useRevealScroll();
  const scroller = useWelcomeScroll();
  if (!ctx || !scroller) return null;
  return <Driver ctx={ctx} scroller={scroller} />;
}

function Driver({ ctx, scroller }: { ctx: RevealScrollContext; scroller: WelcomeScroller }) {
  const { scrollRef, scrollY } = ctx;
  const mirror = scroller.scrollY;
  const { mode, pending, target, from, cur, elapsed, maxY, activate } = scroller._s;

  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      mirror.value = y;
    }
  );

  const stopRef = useRef<(on: boolean) => void>(() => {});
  const stop = useCallback(() => stopRef.current(false), []);

  const fc = useFrameCallback((frame) => {
    "worklet";
    if (mode.value === IDLE) return;
    const ref = scrollRef as AnimatedRef<Animated.ScrollView>;
    const to = Math.min(Math.max(0, target.value), maxY.value);
    if (pending.value === 1) {
      pending.value = 0;
      cur.value = scrollY.value;
      from.value = scrollY.value;
      elapsed.value = 0;
    }
    const dt = (frame.timeSincePreviousFrame ?? 1000 / 60) / 1000;
    let done = false;
    if (mode.value === INSTANT) {
      cur.value = to;
      done = true;
    } else if (mode.value === LERP) {
      // Lenis Animate.advance (lerp mode): frame-rate independent damping.
      cur.value = cur.value + (to - cur.value) * (1 - Math.exp(-LENIS_DAMPING * dt));
      if (Math.round(cur.value) === Math.round(to)) {
        cur.value = to;
        done = true;
      }
    } else {
      // Lenis Animate.advance (duration mode) + defaultEasing.
      elapsed.value += dt;
      const p = Math.min(1, Math.max(0, elapsed.value / TO_TOP_DURATION_S));
      const eased = p >= 1 ? 1 : Math.min(1, 1.001 - Math.pow(2, -10 * p));
      cur.value = from.value + (to - from.value) * eased;
      if (p >= 1) done = true;
    }
    scrollTo(ref, 0, cur.value, false);
    if (done) {
      mode.value = IDLE;
      scheduleOnRN(stop);
    }
  }, false);

  useEffect(() => {
    stopRef.current = fc.setActive;
    activate.current = fc.setActive;
    return () => {
      activate.current = null;
      fc.setActive(false);
    };
  }, [fc, activate]);

  return null;
}
