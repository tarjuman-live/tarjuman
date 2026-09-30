/**
 * Collapsible — the web's `grid-template-rows: 0fr ↔ 1fr` height glide
 * (landing/faq-item.tsx; auth-form confirm-password). Content STAYS MOUNTED
 * (clipped), so both open and close animate; height tracks the measured
 * natural content height, re-measured whenever the content changes size.
 *
 *   <Collapsible open={open}>…answer…</Collapsible>
 *     FAQ: 300ms ease-out (bezier(0,0,.2,1)) — the defaults.
 *   <Collapsible open={isSignUp} fade collapsedMarginBottom={-12}>…</Collapsible>
 *     auth confirm-password: also opacity 0↔1 and margin-bottom -12↔0
 *     (cancels the parent's 12px gap when collapsed).
 *
 * Reduce Motion → instant (web motion-reduce:transition-none).
 * Hidden content is removed from the accessibility tree while collapsed.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type WithTimingConfig,
} from "react-native-reanimated";
import { EASE, useReduceMotion } from "~/lib/motion";

export interface CollapsibleProps {
  open: boolean;
  children: ReactNode;
  /** Default 300 (duration-300). */
  duration?: number;
  /** Default Tailwind ease-out. */
  easing?: WithTimingConfig["easing"];
  /** Also fade the content 0 ↔ 1 (auth confirm-password). */
  fade?: boolean;
  /** Margin-bottom while collapsed (e.g. -12 to absorb a parent gap). */
  collapsedMarginBottom?: number;
  style?: StyleProp<ViewStyle>;
  /** Called with the progress target when a transition starts. */
  onToggle?: (open: boolean) => void;
}

export function Collapsible({
  open,
  children,
  duration = 300,
  easing = EASE.twOut,
  fade = false,
  collapsedMarginBottom = 0,
  style,
  onToggle,
}: CollapsibleProps) {
  const reduce = useReduceMotion();
  const p = useSharedValue(open ? 1 : 0);
  const h = useSharedValue(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onToggle?.(open);
    p.value = withTiming(open ? 1 : 0, {
      duration: reduce ? 0 : duration,
      easing,
      reduceMotion: ReduceMotion.Never,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onLayout = (e: LayoutChangeEvent) => {
    h.value = e.nativeEvent.layout.height;
  };

  const animated = useAnimatedStyle(() => ({
    height: h.value * p.value,
    opacity: fade ? p.value : 1,
    marginBottom: interpolate(p.value, [0, 1], [collapsedMarginBottom, 0]),
  }));

  return (
    <Animated.View
      style={[{ overflow: "hidden" }, style, animated]}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      {/* Absolute so the natural height is measured unconstrained by the
          animated height of the clip box. */}
      <View style={{ position: "absolute", left: 0, right: 0, top: 0 }} onLayout={onLayout}>
        {children}
      </View>
    </Animated.View>
  );
}
