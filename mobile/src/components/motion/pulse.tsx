/**
 * Tailwind `animate-pulse` (pulse 2s cubic-bezier(0.4,0,0.6,1) infinite;
 * 50% { opacity: .5 }) — recording dots, typing carets, the auth-gate tile.
 *
 *   const style = usePulse();                 // animated { opacity }
 *   <Animated.View style={[dot, style]} />
 *   <Pulse style={dot} />                     // same, as a component
 *   usePulse(active)                          // false → rests at opacity 1
 *
 * Not gated by Reduce Motion (the web's animate-pulse isn't either).
 */
import { useEffect } from "react";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { PULSE } from "~/lib/motion";

const half = { duration: PULSE.halfMs, easing: PULSE.easing, reduceMotion: ReduceMotion.Never };

/** Start the 2s pulse loop on a shared value (1 → .5 → 1 …). */
export function startPulse(v: SharedValue<number>) {
  v.value = 1;
  v.value = withRepeat(withSequence(withTiming(PULSE.min, half), withTiming(1, half)), -1, false, undefined, ReduceMotion.Never);
}

/** The raw pulsing opacity value (share it to keep several elements in sync). */
export function usePulseValue(active = true): SharedValue<number> {
  const o = useSharedValue(1);
  useEffect(() => {
    if (active) startPulse(o);
    else {
      cancelAnimation(o);
      o.value = withTiming(1, { duration: 150 });
    }
    return () => cancelAnimation(o);
  }, [active, o]);
  return o;
}

/** Animated `{ opacity }` style for an element that should animate-pulse. */
export function usePulse(active = true) {
  const o = usePulseValue(active);
  return useAnimatedStyle(() => ({ opacity: o.value }));
}

export function Pulse({
  active = true,
  style,
  ...rest
}: ViewProps & { active?: boolean; style?: StyleProp<ViewStyle> }) {
  const s = usePulse(active);
  return <Animated.View {...rest} style={[style, s]} />;
}
