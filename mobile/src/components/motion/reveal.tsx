/**
 * Scroll-driven reveals — the native `whileInView` / IntersectionObserver /
 * ScrollTrigger layer for the Welcome (landing) screen.
 *
 *   <RevealScrollView contentContainerStyle={…}>      // Animated.ScrollView +
 *     <Reveal delay={90} fade={false}>…</Reveal>       // context (scrollRef, scrollY)
 *   </RevealScrollView>
 *
 * <Reveal> mirrors src/components/landing/reveal.tsx EXACTLY:
 *   hidden: opacity 0 (1 when fade=false), translateY +28, scale .96
 *   shown : opacity 1 (600ms SMOOTH, +delay), y/scale (600ms OVERSHOOT, +delay)
 *   exit  : opacity 280ms SMOOTH, y/scale 320ms SMOOTH, NO delay (snappy)
 *   viewport: amount .12, bottom inset 8% (margin '0px 0px -8% 0px'),
 *   once:false → two-way (re-hides on scroll-out, replays on scroll-back).
 *   Reduce Motion → rest pose, never observes (plain View).
 * Outside a RevealScrollView it measures against the window, so on-mount
 * reveals (e.g. above-the-fold content) still play.
 *
 * Lower-level:
 *   useRevealScroll() → { scrollRef, scrollY, layoutTick } | null
 *       (hero parallax, back-to-top `scrollRef.current?.scrollTo({ y: 0 })`)
 *   useInView(opts) → { ref, onLayout, inView: SharedValue<boolean> }
 *       opts.mode = { kind: "amount", amount, insetTop, insetBottom }
 *                 | { kind: "topLine", at }   // gsap start: 'top 82%'
 */
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { Dimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  measure,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  withDelay,
  withTiming,
  type AnimatedRef,
  type AnimatedScrollViewProps,
  type SharedValue,
} from "react-native-reanimated";
import { EASE, REVEAL, useReduceMotion } from "~/lib/motion";

// ─── Scroll context ─────────────────────────────────────────────────────────

export interface RevealScrollContext {
  scrollRef: AnimatedRef<Animated.ScrollView>;
  /** Live contentOffset.y (UI thread). */
  scrollY: SharedValue<number>;
  /** Bumped on content-size changes so observers re-evaluate without a scroll. */
  layoutTick: SharedValue<number>;
}

const Ctx = createContext<RevealScrollContext | null>(null);

export function useRevealScroll(): RevealScrollContext | null {
  return useContext(Ctx);
}

export function RevealScrollView({
  children,
  onContentSizeChange,
  ...rest
}: AnimatedScrollViewProps & { children?: ReactNode }) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scrollRef);
  const layoutTick = useSharedValue(0);
  return (
    <Ctx.Provider value={{ scrollRef, scrollY, layoutTick }}>
      <Animated.ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        {...rest}
        onContentSizeChange={(w: number, h: number) => {
          layoutTick.value += 1;
          if (typeof onContentSizeChange === "function") onContentSizeChange(w, h);
        }}
      >
        {children}
      </Animated.ScrollView>
    </Ctx.Provider>
  );
}

// ─── In-view observer ───────────────────────────────────────────────────────

export type InViewMode =
  | { kind: "amount"; amount: number; insetTop?: number; insetBottom?: number }
  | { kind: "topLine"; at: number };

export interface InViewOptions {
  mode?: InViewMode;
  /** false → never observes; inView stays at `initial`. */
  enabled?: boolean;
  initial?: boolean;
}

export function useInView(opts: InViewOptions = {}) {
  const ctx = useContext(Ctx);
  const ref = useAnimatedRef<Animated.View>();
  const laid = useSharedValue(0);
  const inView = useSharedValue<boolean>(opts.initial ?? false);
  const enabled = opts.enabled ?? true;
  const mode = opts.mode ?? {
    kind: "amount" as const,
    amount: REVEAL.amount,
    insetTop: 0,
    insetBottom: REVEAL.bottomInset,
  };
  const kind = mode.kind;
  const amount = mode.kind === "amount" ? mode.amount : 0;
  const insetTop = mode.kind === "amount" ? (mode.insetTop ?? 0) : 0;
  const insetBottom = mode.kind === "amount" ? (mode.insetBottom ?? 0) : 0;
  const at = mode.kind === "topLine" ? mode.at : 0;
  const scrollY = ctx?.scrollY;
  const tick = ctx?.layoutTick;
  const svRef = ctx?.scrollRef;
  const winH = Dimensions.get("window").height;

  useAnimatedReaction(
    () => {
      if (!enabled) return null;
      // Subscribe to scroll + layout changes.
      if (scrollY) void scrollY.value;
      if (tick) void tick.value;
      void laid.value;
      const r = measure(ref);
      if (!r || r.height === 0) return null;
      let vTop = 0;
      let vH = winH;
      if (svRef) {
        const sv = measure(svRef);
        if (sv) {
          vTop = sv.pageY;
          vH = sv.height;
        }
      }
      if (kind === "topLine") return r.pageY <= vTop + vH * at;
      const top = vTop + vH * insetTop;
      const bottom = vTop + vH * (1 - insetBottom);
      const vis = Math.max(0, Math.min(r.pageY + r.height, bottom) - Math.max(r.pageY, top));
      return vis / r.height >= amount;
    },
    (next) => {
      if (next !== null && next !== inView.value) inView.value = next;
    },
    [enabled, kind, amount, insetTop, insetBottom, at]
  );

  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      laid.value += 1;
    },
    [laid]
  );

  return { ref, onLayout, inView };
}

// ─── <Reveal> ───────────────────────────────────────────────────────────────

export interface RevealProps {
  children: ReactNode;
  /** Stagger delay (ms) before the ENTRANCE (exit never waits). */
  delay?: number;
  /** false = transform-only (opacity stays 1) — above-the-fold content. */
  fade?: boolean;
  /** Hidden-pose rise distance (default 28). */
  y?: number;
  /** Hidden-pose scale (default .96). */
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

export function Reveal({ children, delay = 0, fade = true, y = REVEAL.y, scale = REVEAL.scale, style }: RevealProps) {
  const reduce = useReduceMotion();
  if (reduce) return <Animated.View style={style}>{children}</Animated.View>;
  return (
    <RevealAnimated delay={delay} fade={fade} y={y} scale={scale} style={style}>
      {children}
    </RevealAnimated>
  );
}

function RevealAnimated({ children, delay, fade, y, scale, style }: Required<Omit<RevealProps, "style">> & { style?: StyleProp<ViewStyle> }) {
  const { ref, onLayout, inView } = useInView();
  const o = useSharedValue(0);
  const m = useSharedValue(0);

  useAnimatedReaction(
    () => inView.value,
    (shown, prev) => {
      if (shown === prev) return;
      if (shown) {
        o.value = withDelay(delay, withTiming(1, { duration: REVEAL.shown.opacityMs, easing: EASE.smooth }));
        m.value = withDelay(delay, withTiming(1, { duration: REVEAL.shown.transformMs, easing: EASE.overshoot }));
      } else if (prev !== null) {
        o.value = withTiming(0, { duration: REVEAL.hidden.opacityMs, easing: EASE.smooth });
        m.value = withTiming(0, { duration: REVEAL.hidden.transformMs, easing: EASE.smooth });
      }
    },
    [delay]
  );

  const animated = useAnimatedStyle(() => ({
    opacity: fade ? o.value : 1,
    transform: [{ translateY: y * (1 - m.value) }, { scale: scale + (1 - scale) * m.value }],
  }));

  return (
    <Animated.View ref={ref} onLayout={onLayout} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
