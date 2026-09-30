/**
 * Motion tokens for the native app — a 1:1 mirror of the web's motion system.
 *
 * Every number here is lifted from the web source so a native animation can be
 * written as "the same thing the web does" instead of eyeballed:
 *
 *   Web source                                   → native token
 *   ───────────────────────────────────────────────────────────────────────────
 *   Tailwind v4 bare `transition*` (150ms,       → TW, EASE.tw
 *     cubic-bezier(.4,0,.2,1)); duration-200 etc.
 *   tw-animate-css `animate-in` / `animate-out`   → twEnter() / twExit(),
 *     (default 150ms, CSS `ease`)                    TW_ENTER / TW_EXIT presets
 *   Tailwind `animate-pulse` (2s, bezier(.4,0,.6,1)) → PULSE (+ usePulse in
 *                                                    components/motion/pulse)
 *   Tailwind `animate-spin` (1s linear)           → SPIN
 *   landing/reveal.tsx SMOOTH / OVERSHOOT          → EASE.smooth / EASE.overshoot, REVEAL
 *   recording/animate-in.tsx (easeOutCubic)        → sourceRowEntering / translationRowEntering
 *   ui/drawer.tsx (vaul .5s bezier(.32,.72,0,1))   → VAUL
 *   layout/bottom-nav.tsx useSpring({visualDuration .42, bounce .16})
 *                                                  → SPRING.lens (converted exactly)
 *   landing/heading-reveal.tsx (gsap power3.out)   → EASE_FN.power3Out, HEADING
 *   (app)/template.tsx route enter                 → TW_ENTER.route (+ ScreenEnter)
 *   session-body.tsx typewriter pump               → TYPEWRITER (+ useTypewriter)
 *
 * GOTCHA: Reanimated's `Easing.ease` is bezier(0.42, 0, 1, 1) (CSS ease-IN), NOT
 * CSS `ease`. CSS `ease` is `EASE.css` = bezier(0.25, 0.1, 0.25, 1).
 *
 * REDUCED MOTION POLICY (mirrors MotionProvider `reducedMotion="user"` +
 * globals.css `prefers-reduced-motion` blocks):
 *   - Fades (opacity) keep playing; transforms (translate/scale/rotate) are
 *     dropped → elements appear at their REST pose, never stuck at an end pose.
 *   - Things the web kills outright under reduce (Reveal toggling, heading
 *     split, route enter, sticky glide, transcript row entrance, shimmer) must
 *     check `useReduceMotion()` and render the rest pose with no animation.
 *   - Things the web does NOT gate (animate-pulse, animate-spin, rec-ctl press
 *     scale, dialog fade) keep running — use `reduceMotion: ReduceMotion.Never`.
 *   `REDUCE_MOTION` is a UI-thread SharedValue mirror of the iOS setting (live),
 *   so worklets (layout-animation builders below) can branch on it.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import {
  Easing,
  makeMutable,
  ReduceMotion,
  useReducedMotion,
  withDelay,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";

// ─── Easing curves ──────────────────────────────────────────────────────────

/** Easing factories for `withTiming({ easing })` / layout animations. */
export const EASE = {
  /** CSS `ease` — tw-animate-css default, `.rec-ctl`, hover-card touch-hover. */
  css: Easing.bezier(0.25, 0.1, 0.25, 1),
  /** Tailwind v4 default transition curve (+ `ease-in-out`). */
  tw: Easing.bezier(0.4, 0, 0.2, 1),
  /** Tailwind `ease-out` — FAQ accordion, auth confirm-password collapse. */
  twOut: Easing.bezier(0, 0, 0.2, 1),
  /** Tailwind `ease-in`. */
  twIn: Easing.bezier(0.4, 0, 1, 1),
  /** CSS `ease-in-out` — summary shimmer. */
  cssInOut: Easing.bezier(0.42, 0, 0.58, 1),
  /** `animate-pulse` per-half curve. */
  pulse: Easing.bezier(0.4, 0, 0.6, 1),
  /** Reveal SMOOTH / ask-list FLIP glide (220ms). */
  smooth: Easing.bezier(0.22, 1, 0.36, 1),
  /** Reveal OVERSHOOT — slight pop (y2 > 1 is intentional). */
  overshoot: Easing.bezier(0.34, 1.4, 0.64, 1),
  /** AnimateIn transcript entrance — easeOutCubic. */
  outCubic: Easing.bezier(0.33, 1, 0.68, 1),
  /** vaul drawer TRANSITIONS.EASE. */
  vaul: Easing.bezier(0.32, 0.72, 0, 1),
  /** GSAP scrub catch-up (`expo.out`). */
  expoOut: Easing.out(Easing.exp),
  linear: Easing.linear,
} as const;

/**
 * Plain easing FUNCTIONS for hand-rolled worklet math (e.g. a per-word local
 * progress). Call them as `EASE_FN.power3Out(t)` inside a worklet.
 */
export const EASE_FN = {
  css: Easing.bezierFn(0.25, 0.1, 0.25, 1),
  tw: Easing.bezierFn(0.4, 0, 0.2, 1),
  smooth: Easing.bezierFn(0.22, 1, 0.36, 1),
  overshoot: Easing.bezierFn(0.34, 1.4, 0.64, 1),
  /** GSAP `power3.out` = 1 − (1 − t)^4. */
  power3Out: (t: number) => {
    "worklet";
    return 1 - Math.pow(1 - t, 4);
  },
} as const;

// ─── Durations / timing configs ─────────────────────────────────────────────

/** Tailwind default `transition*` — 150ms, bezier(.4,0,.2,1). */
export const TW: WithTimingConfig = { duration: 150, easing: EASE.tw };

/** Tailwind transition with a `duration-*` override (curve unchanged). */
export const tw = (duration = 150, reduceMotion?: ReduceMotion): WithTimingConfig => ({
  duration,
  easing: EASE.tw,
  ...(reduceMotion ? { reduceMotion } : null),
});

/** CSS-`ease` timing (tw-animate default curve) at a given duration. */
export const cssEase = (duration = 150, reduceMotion?: ReduceMotion): WithTimingConfig => ({
  duration,
  easing: EASE.css,
  ...(reduceMotion ? { reduceMotion } : null),
});

/** `animate-pulse`: 2s loop, 50% → opacity .5, each half on EASE.pulse. */
export const PULSE = { halfMs: 1000, min: 0.5, easing: EASE.pulse } as const;

/** `animate-spin`: 1s linear full turn. */
export const SPIN = { periodMs: 1000 } as const;

/** vaul drawer: .5s bezier(.32,.72,0,1); close on ≥25% drag or > .4 px/ms. */
export const VAUL = {
  duration: 500,
  easing: EASE.vaul,
  closeThreshold: 0.25,
  velocityThreshold: 0.4,
  backdrop: "rgba(6, 11, 24, 0.4)",
} as const;
export const vaulTiming: WithTimingConfig = { duration: VAUL.duration, easing: EASE.vaul };

/** landing/reveal.tsx — asymmetric: overshooting staggered entrance, snappy exit. */
export const REVEAL = {
  y: 28,
  scale: 0.96,
  /** IntersectionObserver amount / rootMargin bottom inset. */
  amount: 0.12,
  bottomInset: 0.08,
  shown: { opacityMs: 600, transformMs: 600 },
  hidden: { opacityMs: 280, transformMs: 320 },
} as const;

/** landing/heading-reveal.tsx — gsap word rise, trigger 'top 82%'. */
export const HEADING = { durationS: 0.7, staggerS: 0.035, yPercent: 110, triggerAt: 0.82 } as const;

/** session-body.tsx two-pump typewriter. */
export const TYPEWRITER = { tickMs: 16, minPerTick: 10, maxPerTick: 48, backlogDivisor: 6 } as const;

/** Landing hover-card: hover 200ms tw curve; touch in-view 300ms CSS ease. */
export const HOVER_CARD = {
  lift: -6,
  glow: "0 14px 36px rgba(46, 204, 113, 0.2)",
  pressMs: 200,
  inViewMs: 300,
  inViewAmount: 0.6,
  inViewInset: 0.12,
} as const;

/**
 * The house green outline-glow (language tiles, dropdown triggers, locale
 * switcher): border → accent + `0 0 0 1px accent, 0 8px 28px accent@22%`,
 * 220ms CSS ease. On native it plays while pressed / while the menu is open.
 */
export const OUTLINE_GLOW = {
  ms: 220,
  shadow: "0 0 0 1px #2ECC71, 0 8px 28px rgba(46, 204, 113, 0.22)",
} as const;

// ─── Springs ────────────────────────────────────────────────────────────────

/**
 * Motion `useSpring({ visualDuration, bounce })` → physics, using motion-dom's
 * exact conversion: root = 2π / (visualDuration·1.2); stiffness = root²;
 * damping = 2·clamp(0.05, 1, 1 − bounce)·√stiffness; mass = 1.
 */
export function motionSpring(visualDuration: number, bounce = 0.3): WithSpringConfig {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  const stiffness = root * root;
  const damping = 2 * Math.min(1, Math.max(0.05, 1 - bounce)) * Math.sqrt(stiffness);
  return { mass: 1, stiffness, damping };
}

export const SPRING = {
  /** Bottom-nav selection lens glide: visualDuration .42, bounce .16. */
  lens: motionSpring(0.42, 0.16),
} as const;

// ─── Reduced motion (live) ──────────────────────────────────────────────────

/**
 * UI-thread mirror of iOS Reduce Motion, kept live by an AccessibilityInfo
 * listener. Read `.value` inside worklets; use `useReduceMotion()` in React.
 */
export const REDUCE_MOTION = makeMutable(false);
let reduceMotionJS = false;
const reduceListeners = new Set<(v: boolean) => void>();

/** True once the OS answered (async query or a change event). */
let reduceResolved = false;

function setReduce(v: boolean) {
  if (v === reduceMotionJS) return;
  reduceMotionJS = v;
  REDUCE_MOTION.value = v;
  reduceListeners.forEach((l) => l(v));
}
function resolveReduce(v: boolean) {
  reduceResolved = true;
  setReduce(v);
}
AccessibilityInfo.isReduceMotionEnabled()
  .then(resolveReduce)
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", resolveReduce);

/**
 * Live Reduce Motion flag — the native `matchMedia('(prefers-reduced-motion:
 * reduce)')` + change listener. Unlike Reanimated's `useReducedMotion()` this
 * re-renders when the user flips the setting.
 */
export function useReduceMotion(): boolean {
  // Reanimated reads the setting synchronously at startup — seed from it so
  // the very first frame is right before the async query answers.
  const startup = useReducedMotion();
  if (!reduceResolved && startup !== reduceMotionJS) {
    // Seed only (no listener fan-out during render).
    reduceMotionJS = startup;
    REDUCE_MOTION.value = startup;
  }
  const [v, setV] = useState(reduceMotionJS);
  useEffect(() => {
    setV(reduceMotionJS);
    reduceListeners.add(setV);
    return () => {
      reduceListeners.delete(setV);
    };
  }, []);
  return v;
}

// ─── tw-animate-css enter / exit builders ───────────────────────────────────

export interface TwAnimateOptions {
  /** `duration-*` (ms). tw-animate default 150. */
  duration?: number;
  /** Default CSS `ease` (tw-animate's `--tw-ease` fallback). */
  easing?: WithTimingConfig["easing"];
  delay?: number;
  /** `fade-in-0` / `fade-out-0` → 0. Omit for no fade. */
  opacity?: number;
  /** `zoom-in-95` / `zoom-out-95` → 0.95. */
  scale?: number;
  /** `slide-in-from-top-1` → -4, `-from-bottom-1` → 4, `-from-bottom-2` → 8. */
  translateY?: number;
  translateX?: number;
  /**
   * 'user' (default) = MotionConfig "user": under Reduce Motion keep the fade,
   * drop transforms. 'system' = skip entirely under Reduce Motion. 'never' =
   * always play in full.
   */
  reduce?: "user" | "system" | "never";
}

type TransformItem = { translateX: number } | { translateY: number } | { scale: number };

/**
 * `animate-in …` → a Reanimated `entering` function. Animates FROM the given
 * values TO the element's natural state (opacity 1, no transform).
 *
 *   entering={twEnter({ opacity: 0, scale: 0.95, duration: 150 })}   // fade-in-0 zoom-in-95
 */
export function twEnter(o: TwAnimateOptions = {}) {
  const duration = o.duration ?? 150;
  const easing = o.easing ?? EASE.css;
  const delay = o.delay ?? 0;
  const mode = o.reduce ?? "user";
  const fromOpacity = o.opacity;
  const tx = o.translateX ?? 0;
  const ty = o.translateY ?? 0;
  const sc = o.scale ?? 1;
  return (_values: EntryAnimationsValues): LayoutAnimation => {
    "worklet";
    const reduce = REDUCE_MOTION.value && mode !== "never";
    const skipAll = reduce && mode === "system";
    const dur = skipAll ? 0 : duration;
    const cfg = { duration: dur, easing, reduceMotion: ReduceMotion.Never };
    const run = (to: number) => (delay > 0 && !skipAll ? withDelay(delay, withTiming(to, cfg)) : withTiming(to, cfg));
    const initialValues: Record<string, unknown> = {};
    const animations: Record<string, unknown> = {};
    if (fromOpacity !== undefined) {
      initialValues.opacity = fromOpacity;
      animations.opacity = run(1);
    }
    if (!reduce) {
      const init: TransformItem[] = [];
      const anim: Record<string, unknown>[] = [];
      if (tx !== 0) {
        init.push({ translateX: tx });
        anim.push({ translateX: run(0) });
      }
      if (ty !== 0) {
        init.push({ translateY: ty });
        anim.push({ translateY: run(0) });
      }
      if (sc !== 1) {
        init.push({ scale: sc });
        anim.push({ scale: run(1) });
      }
      if (init.length) {
        initialValues.transform = init;
        animations.transform = anim;
      }
    }
    return { initialValues, animations } as LayoutAnimation;
  };
}

/**
 * `animate-out …` → a Reanimated `exiting` function. Animates FROM the
 * current natural state TO the given values. Reanimated keeps the view
 * mounted until it finishes — the native Radix Presence / keep-mounted recipe.
 *
 *   exiting={twExit({ opacity: 0, translateY: -4, duration: 200 })}  // fade-out slide-out-to-top-1
 */
export function twExit(o: TwAnimateOptions = {}) {
  const duration = o.duration ?? 150;
  const easing = o.easing ?? EASE.css;
  const delay = o.delay ?? 0;
  const mode = o.reduce ?? "user";
  const toOpacity = o.opacity;
  const tx = o.translateX ?? 0;
  const ty = o.translateY ?? 0;
  const sc = o.scale ?? 1;
  return (_values: ExitAnimationsValues): LayoutAnimation => {
    "worklet";
    const reduce = REDUCE_MOTION.value && mode !== "never";
    const skipAll = reduce && mode === "system";
    const dur = skipAll ? 0 : duration;
    const cfg = { duration: dur, easing, reduceMotion: ReduceMotion.Never };
    const run = (to: number) => (delay > 0 && !skipAll ? withDelay(delay, withTiming(to, cfg)) : withTiming(to, cfg));
    const initialValues: Record<string, unknown> = {};
    const animations: Record<string, unknown> = {};
    if (toOpacity !== undefined) {
      initialValues.opacity = 1;
      animations.opacity = run(toOpacity);
    }
    if (!reduce) {
      const init: TransformItem[] = [];
      const anim: Record<string, unknown>[] = [];
      if (tx !== 0) {
        init.push({ translateX: 0 });
        anim.push({ translateX: run(tx) });
      }
      if (ty !== 0) {
        init.push({ translateY: 0 });
        anim.push({ translateY: run(ty) });
      }
      if (sc !== 1) {
        init.push({ scale: 1 });
        anim.push({ scale: run(sc) });
      }
      if (init.length) {
        initialValues.transform = init;
        animations.transform = anim;
      }
    }
    return { initialValues, animations } as LayoutAnimation;
  };
}

/** The recurring tw-animate recipes of the web app, ready to drop in. */
export const TW_ENTER = {
  /** `fade-in-0` (overlays; tw default 150ms ease). */
  fade: twEnter({ opacity: 0 }),
  /** `fade-in-0 zoom-in-95 duration-150` — Radix dialog / auth card. */
  dialog: twEnter({ opacity: 0, scale: 0.95, duration: 150 }),
  /** `fade-in slide-in-from-top-1 duration-200` — dropdown panel (opens down). */
  dropdown: twEnter({ opacity: 0, translateY: -4, duration: 200 }),
  /** `fade-in slide-in-from-bottom-1 duration-200` — drop-up panel. */
  dropup: twEnter({ opacity: 0, translateY: 4, duration: 200 }),
  /** `fade-in slide-in-from-bottom-2 duration-200` — (app)/template.tsx. Skipped under reduce. */
  route: twEnter({ opacity: 0, translateY: 8, duration: 200, reduce: "system" }),
} as const;

export const TW_EXIT = {
  fade: twExit({ opacity: 0 }),
  dialog: twExit({ opacity: 0, scale: 0.95, duration: 150 }),
  dropdown: twExit({ opacity: 0, translateY: -4, duration: 200 }),
  dropup: twExit({ opacity: 0, translateY: 4, duration: 200 }),
} as const;

// ─── Transcript row entrance (recording/animate-in.tsx) ─────────────────────

/**
 * AnimateIn variant="source": opacity 0→1, y 14→0, scale .985→1, 620ms
 * easeOutCubic. The web's `y` channel is a silent no-op (motion/mini) — the
 * native port implements the INTENDED 14px rise. Under Reduce Motion the row
 * is shown instantly (web `finalize()` path). Apply only to NEW live rows.
 */
export const sourceRowEntering = twEnter({
  opacity: 0,
  translateY: 14,
  scale: 0.985,
  duration: 620,
  easing: EASE.outCubic,
  reduce: "system",
});

/** AnimateIn variant="translation": opacity 0→1, y 10→0 (no scale), 520ms easeOutCubic. */
export const translationRowEntering = twEnter({
  opacity: 0,
  translateY: 10,
  duration: 520,
  easing: EASE.outCubic,
  reduce: "system",
});
