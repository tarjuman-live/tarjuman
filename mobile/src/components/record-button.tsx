/**
 * Record-screen buttons + the nav-visibility flag.
 *
 * IdleRecordButton — src/components/recording/record-button.tsx
 *   120px circle, linear-gradient(135deg, accent, accentDk), static glow
 *   `0 0 40px accent@30, 0 0 0 8px accentSoft`. `transition-all duration-200`
 *   (200ms bezier(.4,0,.2,1)):
 *     active:scale-95                 → press scale 1 → .95
 *     hover:brightness-110            → no hover on touch; folded into the
 *                                       press as a crossfade to a ×1.1-brightness
 *                                       copy of the gradient (#33E07C → #25B963,
 *                                       the exact brightness(1.1) of each stop)
 *     hover:scale-105                 → dropped (active overrides it on press)
 *     disabled:opacity-60             → opacity 1 ↔ .6 fades over the same 200ms
 *   The Rive face (rive-record-button.tsx) never ships — the .riv asset does not
 *   exist, so the web always renders this static mic icon too.
 *
 * RecCtl — globals.css `.rec-ctl` (+ -pause / -resume / -stop)
 *   56px circles, 1px border; `transition: transform, background-color,
 *   border-color 150ms ease`. :active scale .95; :hover background → colour@22%,
 *   border → solid colour. Hover is mapped onto the press (the colour intensifies
 *   while the finger is down, together with the squash). The :hover scale 1.06
 *   is dropped — :active's .95 wins while pressed on the web too.
 *   Not gated by Reduce Motion (the web's isn't).
 *   Pause ⇄ resume is one persistent element on the web (unkeyed ternary <button>,
 *   only the class swaps), so its colours crossfade amber → accent over 150ms
 *   while the :active squash releases. RecCtl mirrors that: keep ONE instance and
 *   flip `variant`; the palette glides, only the SF Symbol swaps instantly.
 *
 * recordNav — the web's NavVisibility flag (record/page.tsx: hide the bottom
 *   nav while recording/paused). Published by the Record screen; the tabs
 *   layout's BottomNav reads it with `useRecordNavHidden()` and runs the web's
 *   320ms hide-slide + fade (bottom-nav.tsx) in both directions.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";

// ─── Nav visibility (web: components/layout/nav-visibility) ──────────────────

let navHidden = false;
const navListeners = new Set<() => void>();

/** Set by the Record screen (recording / paused / stopping). */
export function setRecordNavHidden(hidden: boolean) {
  if (hidden === navHidden) return;
  navHidden = hidden;
  navListeners.forEach((l) => l());
}

/** For app/(tabs)/_layout.tsx: the BottomNav hide-slide reads this. */
export function useRecordNavHidden(): boolean {
  return useSyncExternalStore(
    (cb) => {
      navListeners.add(cb);
      return () => {
        navListeners.delete(cb);
      };
    },
    () => navHidden,
    () => false
  );
}

// ─── Idle record button ───────────────────────────────────────────────────────

const REC_T = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
/** brightness(1.1) of each gradient stop. */
const BRIGHT = ["#33E07C", "#25B963"] as const;

export function IdleRecordButton({
  onPress,
  disabled,
  accessibilityLabel,
}: {
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const press = useSharedValue(0);
  const dim = useSharedValue(disabled ? 1 : 0);

  useEffect(() => {
    dim.value = withTiming(disabled ? 1 : 0, REC_T);
    if (disabled) press.value = withTiming(0, REC_T);
  }, [disabled, dim, press]);

  const outer = useAnimatedStyle(() => ({
    opacity: interpolate(dim.value, [0, 1], [1, 0.6]),
    transform: [{ scale: interpolate(press.value, [0, 1], [1, 0.95]) }],
  }));
  const bright = useAnimatedStyle(() => ({ opacity: press.value }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        press.value = withTiming(1, REC_T);
      }}
      onPressOut={() => {
        press.value = withTiming(0, REC_T);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View style={[styles.recOuter, outer]}>
        <View style={styles.recClip}>
          <LinearGradient
            colors={[C.accent, C.accentDk]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, bright]}>
            <LinearGradient colors={BRIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
          <SymbolView name="mic.fill" tintColor="#fff" size={40} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ─── Circular recording controls (.rec-ctl) ──────────────────────────────────

export type RecCtlVariant = "pause" | "resume" | "stop";

const CTL: Record<
  RecCtlVariant,
  { bg: [string, string]; border: [string, string]; icon: SFSymbol; tint: string }
> = {
  pause: {
    bg: ["rgba(245,158,11,0.1)", "rgba(245,158,11,0.22)"],
    border: ["rgba(245,158,11,0.4)", C.amber],
    icon: "pause.fill",
    tint: C.amber,
  },
  resume: {
    bg: ["rgba(46,204,113,0.1)", "rgba(46,204,113,0.22)"],
    border: ["rgba(46,204,113,0.4)", C.accent],
    icon: "play.fill",
    tint: C.accent,
  },
  stop: {
    bg: ["rgba(239,68,68,0.1)", "rgba(239,68,68,0.22)"],
    border: ["rgba(239,68,68,0.3)", C.red],
    icon: "stop.fill",
    tint: C.red,
  },
};

const CTL_T = { duration: 150, easing: EASE.css, reduceMotion: ReduceMotion.Never };

export function RecCtl({
  variant,
  onPress,
  disabled,
  accessibilityLabel,
  children,
  style,
}: {
  variant: RecCtlVariant;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** Replaces the icon (e.g. a spinner while stopping). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const v = CTL[variant];
  const p = useSharedValue(0);
  // Pause ⇄ resume is ONE persistent control, like the web's unkeyed <button>
  // that only swaps .rec-ctl-pause → .rec-ctl-resume: its background/border
  // crossfade over the same 150ms ease while the press scale releases. Render
  // a single <RecCtl variant={paused ? "resume" : "pause"}> (no key) to get it.
  // `mix` 0 = pause palette, 1 = resume palette; the stop control ignores it.
  const isStop = variant === "stop";
  const mix = useSharedValue(variant === "resume" ? 1 : 0);
  useEffect(() => {
    if (variant === "stop") return;
    mix.value = withTiming(variant === "resume" ? 1 : 0, CTL_T);
  }, [variant, mix]);

  const animated = useAnimatedStyle(() => {
    let bgRest: string;
    let bgHot: string;
    let bdRest: string;
    let bdHot: string;
    if (isStop) {
      bgRest = CTL.stop.bg[0];
      bgHot = CTL.stop.bg[1];
      bdRest = CTL.stop.border[0];
      bdHot = CTL.stop.border[1];
    } else {
      const m = mix.value;
      bgRest = interpolateColor(m, [0, 1], [CTL.pause.bg[0], CTL.resume.bg[0]]);
      bgHot = interpolateColor(m, [0, 1], [CTL.pause.bg[1], CTL.resume.bg[1]]);
      bdRest = interpolateColor(m, [0, 1], [CTL.pause.border[0], CTL.resume.border[0]]);
      bdHot = interpolateColor(m, [0, 1], [CTL.pause.border[1], CTL.resume.border[1]]);
    }
    return {
      backgroundColor: interpolateColor(p.value, [0, 1], [bgRest, bgHot]),
      borderColor: interpolateColor(p.value, [0, 1], [bdRest, bdHot]),
      transform: [{ scale: interpolate(p.value, [0, 1], [1, 0.95]) }],
    };
  });
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        p.value = withTiming(1, CTL_T);
      }}
      onPressOut={() => {
        p.value = withTiming(0, CTL_T);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View style={[styles.ctl, style, animated]}>
        {/* Only the glyph swaps instantly (web: the icon is a ternary child). */}
        {children ?? <SymbolView name={v.icon} tintColor={v.tint} size={22} />}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  recOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    boxShadow: "0 0 40px rgba(46,204,113,0.19), 0 0 0 8px rgba(46,204,113,0.1)",
  },
  recClip: {
    flex: 1,
    borderRadius: 60,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  ctl: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
