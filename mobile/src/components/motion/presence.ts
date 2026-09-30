/**
 * Presence helpers — the house "visible-state keep-mounted" recipe (web:
 * Radix Presence / `visible` state + setTimeout) for things hosted in an RN
 * <Modal>, where Reanimated `exiting` would be cut because the Modal itself
 * unmounts.
 *
 *   const { mounted, progress } = usePresenceProgress(open, {
 *     enter: { duration: 150, easing: EASE.css },
 *     exit:  { duration: 150, easing: EASE.css },
 *   });
 *   <Modal visible={mounted} transparent animationType="none">…</Modal>
 *   // drive styles from progress (0 = closed pose, 1 = open pose)
 *
 * Opening mid-close re-targets from the current value (interruptible, like
 * CSS/Motion); `mounted` only drops after an exit that actually finished.
 *
 *   const mounted = usePresence(open, 200);   // timer-only variant (for
 *                                             // entering/exiting children)
 */
import { useEffect, useRef, useState } from "react";
import {
  ReduceMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { EASE } from "~/lib/motion";

export interface PresenceOptions {
  enter?: WithTimingConfig;
  exit?: WithTimingConfig;
  /** Called on the JS thread after the exit animation finished and it unmounted. */
  onExited?: () => void;
}

export function usePresenceProgress(
  open: boolean,
  opts: PresenceOptions = {}
): { mounted: boolean; progress: SharedValue<number> } {
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(0);
  const enter = opts.enter ?? { duration: 150, easing: EASE.css };
  const exit = opts.exit ?? enter;
  const onExitedRef = useRef(opts.onExited);
  onExitedRef.current = opts.onExited;
  const firstRef = useRef(true);

  useEffect(() => {
    const unmount = () => {
      setMounted(false);
      onExitedRef.current?.();
    };
    const first = firstRef.current;
    firstRef.current = false;
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, { reduceMotion: ReduceMotion.Never, ...enter });
    } else if (!first) {
      progress.value = withTiming(0, { reduceMotion: ReduceMotion.Never, ...exit }, (finished) => {
        if (finished) scheduleOnRN(unmount);
      });
    }
    // enter/exit are config literals; only `open` drives the transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { mounted, progress };
}

/** Keep something mounted for `exitMs` after `open` goes false. */
export function usePresence(open: boolean, exitMs: number): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(id);
  }, [open, exitMs]);
  return open || mounted;
}
