/**
 * HoverCard — the landing cards' hover (features / use-cases / FAQ / pricing /
 * early-note) ported to touch, mirroring BOTH web paths:
 *
 *  1. Desktop hover → PRESS: `transition duration-200` (200ms bezier(.4,0,.2,1)):
 *     translateY 0 → -6, border borderLight → accent, bg surface → surfaceLight,
 *     shadow none → 0 14px 36px accent@20%.
 *  2. Touch "auto-hover" (auto-hover-grid.tsx + globals.css .touch-hover):
 *     while ≥60% of the card is inside the viewport inset 12% top/bottom, it
 *     plays the SUBSET lift + border + glow at 300ms CSS ease. Several cards
 *     can be lit at once (IntersectionObserver per card). Needs a
 *     <RevealScrollView> ancestor; off under Reduce Motion (web returns early).
 *
 *   <HoverCard style={styles.card} onPress={…} inViewScope="full">
 *     <HoverAccentBar />          // 3px left bar, scaleY 0→1 from the top, 300ms
 *     …children read useHoverTiming(ms) for their own parts (icon tilt, title nudge)
 *   </HoverCard>
 *
 * Context (useHoverProgress()):
 *   press / active   — 0..1 PROGRESS (press = desktop-hover set at pressMs,
 *                      active = max(press, in-view 300ms)).
 *   pressTarget / activeTarget / partsTarget — raw 0|1 TARGETS, so a child
 *                      part can run its OWN web duration (useHoverTiming).
 *   partsTarget follows inViewScope: "subset" → press only (mobile-web
 *   parity: the bar / icon / title never play on scroll), "full" → press OR
 *   in-view (every web hover effect also auto-plays, since iOS can't hover).
 *   reduce           — Reduce Motion (only the touch in-view path is off; press
 *                      transforms still play, as the web does not gate them).
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";
import { C } from "~/lib/theme";
import { EASE, HOVER_CARD, useReduceMotion } from "~/lib/motion";
import { useInView } from "./reveal";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface HoverCtx {
  /** Desktop-hover progress (0..1, pressMs tw). */
  press: SharedValue<number>;
  /** max(press, in-view progress). */
  active: SharedValue<number>;
  /** Raw 0|1 press/held target. */
  pressTarget: SharedValue<number>;
  /** Raw 0|1 max(press, in-view) target. */
  activeTarget: SharedValue<number>;
  /** Raw 0|1 target the child PARTS follow (depends on inViewScope). */
  partsTarget: SharedValue<number>;
  reduce: boolean;
  /** Drive the card's press (desktop-hover) state from a child control. */
  pressIn: () => void;
  pressOut: () => void;
}
const Ctx = createContext<HoverCtx | null>(null);

/** Hover progress of the nearest HoverCard (null outside one). */
export function useHoverProgress(): HoverCtx | null {
  return useContext(Ctx);
}

/**
 * A child part's own hover transition (e.g. `transition-transform
 * duration-300` on the accent bar vs the card's 200ms): 0 → 1 while the card
 * is hovered (pressed / in view per inViewScope), with THIS part's duration.
 * Outside a HoverCard it stays 0.
 */
export function useHoverTiming(
  duration: number,
  easing: WithTimingConfig["easing"] = EASE.tw
): SharedValue<number> {
  const ctx = useContext(Ctx);
  const target = ctx?.partsTarget;
  const p = useSharedValue(0);
  useAnimatedReaction(
    () => (target ? target.value : 0),
    (t, prev) => {
      if (t === prev) return;
      p.value = withTiming(t, { duration, easing, reduceMotion: ReduceMotion.Never });
    },
    [duration]
  );
  return p;
}

export interface HoverCardProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Lift while hovered (default -6 = hover:-translate-y-1.5). */
  lift?: number;
  /** Border rest → hover; null keeps the style's border static. */
  borderColors?: [string, string] | null;
  /** Background rest → hover; null keeps the style's bg static (pricing). */
  bgColors?: [string, string] | null;
  /** Static glow shadow faded in on hover; null for none. */
  glow?: string | null;
  /** Press transition (default 200). */
  pressMs?: number;
  /** Enable the touch in-view auto-hover (default true). */
  touchInView?: boolean;
  /** "subset" (mobile-web parity: lift/border/glow) or "full" (everything). */
  inViewScope?: "subset" | "full";
  /** Hold the hover state on (e.g. an open FAQ row). */
  active?: boolean;
  /**
   * true (default): the whole card is ONE pressable accessibility element.
   * false: the card is a plain, non-grouped container (VoiceOver reaches each
   * child separately) and a child <HoverPressable> is the control that lights
   * the highlight — e.g. the FAQ row, where on the web only the question
   * <button> toggles and the answer <p> is its own readable element.
   */
  interactive?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
}

export function HoverCard({
  children,
  style,
  onPress,
  lift = HOVER_CARD.lift,
  borderColors = [C.borderLight, C.accent],
  bgColors = [C.surface, C.surfaceLight],
  glow = HOVER_CARD.glow,
  pressMs = HOVER_CARD.pressMs,
  touchInView = true,
  inViewScope = "subset",
  active = false,
  interactive = true,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  accessibilityState,
}: HoverCardProps) {
  const reduce = useReduceMotion();
  const press = useSharedValue(active ? 1 : 0);
  const pressTarget = useSharedValue(active ? 1 : 0);
  const pressing = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const view = useSharedValue(0);
  const viewTarget = useSharedValue(0);
  const { ref, onLayout, inView } = useInView({
    enabled: touchInView && !reduce,
    mode: {
      kind: "amount",
      amount: HOVER_CARD.inViewAmount,
      insetTop: HOVER_CARD.inViewInset,
      insetBottom: HOVER_CARD.inViewInset,
    },
  });

  const pressCfg: WithTimingConfig = { duration: pressMs, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
  const setPress = (on: boolean) => {
    pressTarget.value = on ? 1 : 0;
    press.value = withTiming(on ? 1 : 0, pressCfg);
  };

  useEffect(() => {
    setPress(active || pressing.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Reduce Motion flipped on while lit → drop the in-view state (web: the
  // observer never runs under reduce).
  useEffect(() => {
    if (reduce || !touchInView) {
      viewTarget.value = 0;
      view.value = withTiming(0, { duration: HOVER_CARD.inViewMs, easing: EASE.css });
    }
  }, [reduce, touchInView, view, viewTarget]);

  useAnimatedReaction(
    () => inView.value,
    (on, prev) => {
      if (on === prev) return;
      viewTarget.value = on ? 1 : 0;
      view.value = withTiming(on ? 1 : 0, {
        duration: HOVER_CARD.inViewMs,
        easing: EASE.css,
        reduceMotion: ReduceMotion.Never,
      });
    }
  );

  const activeV = useDerivedValue(() => Math.max(press.value, view.value));
  const activeTarget = useDerivedValue(() => Math.max(pressTarget.value, viewTarget.value));
  const full = inViewScope === "full";
  const partsTarget = useDerivedValue(() => (full ? activeTarget.value : pressTarget.value));

  const animated = useAnimatedStyle(() => {
    const h = activeV.value; // lift / border / glow
    const b = full ? h : press.value; // background (desktop-hover only by default)
    // Web parity: the desktop `hover:-translate-y-1.5` is NOT reduce-gated, so
    // the press lift keeps playing. Only the touch in-view path is killed under
    // reduce (globals.css `.touch-hover { transform: none }`), and that path is
    // already disabled above (`enabled: touchInView && !reduce`, view → 0).
    const s: ViewStyle = { transform: [{ translateY: lift * h }] };
    if (borderColors) s.borderColor = interpolateColor(h, [0, 1], borderColors) as string;
    if (bgColors) s.backgroundColor = interpolateColor(b, [0, 1], bgColors) as string;
    return s;
  });
  // globals.css reduce block: `.touch-hover { box-shadow: none }` — and the
  // in-view path is off under reduce anyway, so only the press glow remains.
  const pressIn = () => {
    pressing.current = true;
    setPress(true);
  };
  const pressOut = () => {
    pressing.current = false;
    // Defer one frame: when the tap toggles `active` on (an FAQ row
    // opening), the re-render lands first and the highlight never dips.
    requestAnimationFrame(() => {
      if (!pressing.current && !activeRef.current) setPress(false);
    });
  };

  const glowStyle = useAnimatedStyle(() => ({ opacity: reduce ? press.value : activeV.value }));
  const radius = (StyleSheet.flatten(style)?.borderRadius as number | undefined) ?? 16;

  const glowLayer = glow ? (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, boxShadow: glow }, glowStyle]}
    />
  ) : null;

  return (
    <Ctx.Provider value={{ press, active: activeV, pressTarget, activeTarget, partsTarget, reduce, pressIn, pressOut }}>
      <Animated.View ref={ref} onLayout={onLayout}>
        {interactive ? (
          <AnimatedPressable
            accessibilityRole={accessibilityRole ?? (onPress ? "button" : undefined)}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
            accessibilityState={accessibilityState}
            onPress={onPress}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={[style, animated]}
          >
            {glowLayer}
            {children}
          </AnimatedPressable>
        ) : (
          <Animated.View accessible={false} style={[style, animated]}>
            {glowLayer}
            {children}
          </Animated.View>
        )}
      </Animated.View>
    </Ctx.Provider>
  );
}

/**
 * The control inside a non-interactive <HoverCard interactive={false}>: a plain
 * Pressable that lights the card's hover highlight while pressed (same
 * pressMs tw as the card's own press path) and carries the accessibility
 * role/label/state itself. Outside a HoverCard it is just a Pressable.
 */
export function HoverPressable({ onPressIn, onPressOut, ...rest }: PressableProps) {
  const ctx = useContext(Ctx);
  return (
    <Pressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        ctx?.pressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        ctx?.pressOut();
        onPressOut?.(e);
      }}
    />
  );
}

/**
 * The cards' left accent bar: `absolute left-0 top-0 h-full w-[3px] origin-top
 * scale-y-0 transition-transform duration-300 group-hover:scale-y-100`.
 * Draws top → bottom over 300ms tw and retracts on release. Physical `left`
 * (the web doesn't flip it for RTL). Clipped to the card's inner rounded
 * corner by its own layer, so the card itself needs no overflow:hidden (that
 * would clip the glow). Reduce Motion: unchanged — the web's
 * `transition-transform` here is not reduce-gated, so the bar still scales.
 */
export function HoverAccentBar({
  innerRadius = 15,
  width = 3,
  color = C.accent,
}: {
  /** Card border radius minus its border width (default 16 − 1). */
  innerRadius?: number;
  width?: number;
  color?: string;
}) {
  const p = useHoverTiming(300, EASE.tw);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleY: p.value }] }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: innerRadius, overflow: "hidden" }]}>
      <Animated.View
        style={[
          { position: "absolute", left: 0, top: 0, bottom: 0, width, backgroundColor: color, transformOrigin: "top" },
          bar,
        ]}
      />
    </View>
  );
}
