/**
 * Spinner — Tailwind `animate-spin` ring (spin 1s linear infinite) as used by
 * the billing pages and avatar upload: a `border-2` ring in white/10 with an
 * accent top arc. ActivityIndicator would not match the green-arc look.
 *
 *   <Spinner />                    // 20px, accent arc
 *   <Spinner size={16} color={C.bg} track="rgba(10,15,28,0.2)" />
 *
 * Not gated by Reduce Motion (the web's animate-spin isn't).
 */
import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { C } from "~/lib/theme";
import { SPIN } from "~/lib/motion";

export interface SpinnerProps {
  size?: number;
  thickness?: number;
  /** Arc colour (border-top). Default accent. */
  color?: string;
  /** Ring colour. Default rgba(255,255,255,0.1). */
  track?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Spinner({
  size = 20,
  thickness = 2,
  color = C.accent,
  track = "rgba(255,255,255,0.1)",
  style,
  accessibilityLabel,
}: SpinnerProps) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = 0;
    r.value = withRepeat(
      withTiming(360, { duration: SPIN.periodMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1,
      false,
      undefined,
      ReduceMotion.Never
    );
    return () => cancelAnimation(r);
  }, [r]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: track,
          borderTopColor: color,
        },
        style,
        spin,
      ]}
    />
  );
}
