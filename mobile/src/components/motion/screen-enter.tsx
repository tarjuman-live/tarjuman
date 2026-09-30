/**
 * ScreenEnter — mirror of src/app/(app)/template.tsx: every (app) route change
 * replays `animate-in fade-in slide-in-from-bottom-2 duration-200` on the page
 * content (opacity 0 → 1, translateY 8 → 0, 200ms CSS ease). NativeTabs keep
 * tab screens mounted, so this replays on every FOCUS instead of on mount.
 * The native tab bar (like the web BottomNav) never re-animates.
 *
 *   export default function History() {
 *     return <ScreenEnter>{…screen…}</ScreenEnter>;
 *   }
 *
 * Reduce Motion → no animation (web `motion-reduce:animate-none`).
 * For pushed stack screens (session/[id]) keep the native push; wrapping the
 * content is optional (replayOnFocus={false} plays once on mount).
 */
import { useCallback, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { EASE, useReduceMotion } from "~/lib/motion";

export interface ScreenEnterProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Replay on every focus (tabs). Default true. */
  replayOnFocus?: boolean;
}

export function ScreenEnter({ children, style, replayOnFocus = true }: ScreenEnterProps) {
  const reduce = useReduceMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  const played = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      if (reduce) {
        p.value = 1;
        return;
      }
      if (!replayOnFocus && played.value) return;
      played.value = 1;
      p.value = 0;
      p.value = withTiming(1, { duration: 200, easing: EASE.css, reduceMotion: ReduceMotion.Never });
    }, [reduce, replayOnFocus, p, played])
  );

  const animated = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: 8 * (1 - p.value) }],
  }));

  return <Animated.View style={[{ flex: 1 }, style, animated]}>{children}</Animated.View>;
}
