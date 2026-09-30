/**
 * Press progress for the Welcome screen's hover-mapped controls.
 *
 * The landing page's hover transitions (Tailwind `transition-* duration-*`,
 * inline `transition: … 200ms ease`) become PRESS states on iOS: 0 → 1 on
 * press-in, 1 → 0 on press-out, with the web's own duration + curve. The web
 * does not gate these CSS transitions on prefers-reduced-motion (except where
 * a `motion-reduce:` class says so — pass `instant`), so they always run.
 */
import { useCallback } from "react";
import { ReduceMotion, useSharedValue, withTiming, type WithTimingConfig } from "react-native-reanimated";

export function usePressProgress(duration: number, easing: WithTimingConfig["easing"], instant = false) {
  const p = useSharedValue(0);
  const to = useCallback(
    (v: number) => {
      p.value = instant ? v : withTiming(v, { duration, easing, reduceMotion: ReduceMotion.Never });
    },
    [p, duration, easing, instant]
  );
  const onPressIn = useCallback(() => to(1), [to]);
  const onPressOut = useCallback(() => to(0), [to]);
  return { p, onPressIn, onPressOut };
}
