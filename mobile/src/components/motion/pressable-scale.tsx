/**
 * PressableScale — the native form of the web's press/hover conventions.
 *
 * Mirrors:
 *   - `transition-transform active:scale-[0.98]` (dialogs, AI tools, copy…) →
 *     scaleTo 0.98 (default), 150ms bezier(.4,0,.2,1)
 *   - `active:scale-95` (error retry, Got it) → scaleTo={0.95}
 *   - `.rec-ctl` (transform 150ms CSS ease, :active scale .95) →
 *     scaleTo={0.95} easing={EASE.css}
 *   - shadcn `active:translate-y-px` nudge → translateYTo={1}
 *   - hover lifts (`hover:-translate-y-0.5`) mapped to press → translateYTo={-2}
 *   - `disabled:opacity-50` → disabledOpacity (snaps by default, like the web's
 *     `transition-transform`-only buttons; `animateDisabled` fades 150ms for
 *     `transition-all` buttons)
 *   - hover border/bg colour changes → `pressColors` (interpolated while pressed)
 *   - the house GREEN OUTLINE-GLOW hover (border → accent + 1px ring + soft
 *     glow, 220ms CSS ease) → `glow` (while pressed) / `glowActive` (held on,
 *     e.g. while its menu is open)
 *
 * Press scale is NOT gated by Reduce Motion (the web's active:scale isn't).
 *
 * Props: all Pressable props (minus style/children) plus the ones below.
 * `style` goes on the animated container (put your bg/border/radius there).
 */
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import {
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type WithTimingConfig,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { C } from "~/lib/theme";
import { EASE, OUTLINE_GLOW } from "~/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface GlowSpec {
  /** Border colour at rest (default C.borderLight). */
  borderFrom?: string;
  /** Border colour when lit (default C.accent). */
  borderTo?: string;
  /** Static box-shadow of the glow layer, faded in (default OUTLINE_GLOW.shadow). */
  shadow?: string;
  /** Fade duration (default 220, CSS ease). */
  duration?: number;
}

export interface PressColors {
  backgroundColor?: [string, string];
  borderColor?: [string, string];
  /** default 150 */
  duration?: number;
}

export interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  /** React 19 ref-as-prop: the underlying Pressable (e.g. a popover anchor). */
  ref?: Ref<View>;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. 1 disables. Default 0.98. */
  scaleTo?: number;
  /** translateY while pressed (1 = shadcn nudge, -2 = hover lift). Default 0. */
  translateYTo?: number;
  /** Press transition duration. Default 150. */
  duration?: number;
  /** Press transition curve. Default EASE.tw (Tailwind). */
  easing?: WithTimingConfig["easing"];
  /** Opacity when disabled. Default 0.5 (web disabled:opacity-50). */
  disabledOpacity?: number;
  /** Fade the disabled opacity (150ms) instead of snapping. Default false. */
  animateDisabled?: boolean;
  /** Colour shifts while pressed (web hover:bg-… / hover:border-…). */
  pressColors?: PressColors;
  /** Green outline-glow while pressed. `true` = house defaults. */
  glow?: boolean | GlowSpec;
  /** Hold the glow lit regardless of press (e.g. its dropdown is open). */
  glowActive?: boolean;
  /** Optional haptic on press-in (web navigator.vibrate on record controls). */
  haptic?: "light" | "medium" | "heavy" | "selection";
}

export function PressableScale({
  children,
  style,
  scaleTo = 0.98,
  translateYTo = 0,
  duration = 150,
  easing = EASE.tw,
  disabledOpacity = 0.5,
  animateDisabled = false,
  pressColors,
  glow,
  glowActive = false,
  haptic,
  disabled,
  onPressIn,
  onPressOut,
  ref,
  ...rest
}: PressableScaleProps) {
  const pressed = useSharedValue(0);
  const colors = useSharedValue(0);
  const lit = useSharedValue(glowActive ? 1 : 0);
  const dim = useSharedValue(disabled ? 1 : 0);
  const pressingRef = useRef(false);

  const glowSpec: GlowSpec | null = glow ? (glow === true ? {} : glow) : null;
  const glowMs = glowSpec?.duration ?? OUTLINE_GLOW.ms;
  const glowFrom = glowSpec?.borderFrom ?? C.borderLight;
  const glowTo = glowSpec?.borderTo ?? C.accent;
  const glowShadow = glowSpec?.shadow ?? OUTLINE_GLOW.shadow;
  const colorMs = pressColors?.duration ?? 150;
  const bg = pressColors?.backgroundColor;
  const bd = pressColors?.borderColor;

  const cfg: WithTimingConfig = { duration, easing, reduceMotion: ReduceMotion.Never };
  const glowCfg: WithTimingConfig = { duration: glowMs, easing: EASE.css, reduceMotion: ReduceMotion.Never };
  const colorCfg: WithTimingConfig = { duration: colorMs, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

  useEffect(() => {
    dim.value = animateDisabled
      ? withTiming(disabled ? 1 : 0, { duration: 150, easing: EASE.tw })
      : disabled
        ? 1
        : 0;
  }, [disabled, animateDisabled, dim]);

  useEffect(() => {
    if (!glowSpec) return;
    lit.value = withTiming(glowActive || pressingRef.current ? 1 : 0, glowCfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowActive, !!glowSpec]);

  const handleIn = (e: GestureResponderEvent) => {
    pressingRef.current = true;
    pressed.value = withTiming(1, cfg);
    if (pressColors) colors.value = withTiming(1, colorCfg);
    if (glowSpec) lit.value = withTiming(1, glowCfg);
    if (haptic) {
      if (haptic === "selection") void Haptics.selectionAsync().catch(() => {});
      else
        void Haptics.impactAsync(
          haptic === "light"
            ? Haptics.ImpactFeedbackStyle.Light
            : haptic === "medium"
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Heavy
        ).catch(() => {});
    }
    onPressIn?.(e);
  };
  const handleOut = (e: GestureResponderEvent) => {
    pressingRef.current = false;
    pressed.value = withTiming(0, cfg);
    if (pressColors) colors.value = withTiming(0, colorCfg);
    if (glowSpec && !glowActive) lit.value = withTiming(0, glowCfg);
    onPressOut?.(e);
  };

  const animated = useAnimatedStyle(() => {
    const s: ViewStyle = {
      opacity: interpolate(dim.value, [0, 1], [1, disabledOpacity]),
      transform: [
        { translateY: translateYTo * pressed.value },
        { scale: interpolate(pressed.value, [0, 1], [1, scaleTo]) },
      ],
    };
    if (bg) s.backgroundColor = interpolateColor(colors.value, [0, 1], bg) as string;
    if (bd) s.borderColor = interpolateColor(colors.value, [0, 1], bd) as string;
    if (glowSpec) {
      // Glow border wins over pressColors' border (it is the stronger state).
      s.borderColor = interpolateColor(lit.value, [0, 1], [glowFrom, glowTo]) as string;
    }
    return s;
  });

  const glowLayer = useAnimatedStyle(() => ({ opacity: lit.value }));
  const radius = (StyleSheet.flatten(style)?.borderRadius as number | undefined) ?? 0;

  return (
    <AnimatedPressable
      {...rest}
      ref={ref}
      disabled={disabled}
      onPressIn={handleIn}
      onPressOut={handleOut}
      style={[style, animated]}
    >
      {glowSpec ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, boxShadow: glowShadow },
            glowLayer,
          ]}
        />
      ) : null}
      {children}
    </AnimatedPressable>
  );
}
