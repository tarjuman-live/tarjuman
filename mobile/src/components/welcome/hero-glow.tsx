/**
 * The ambient green light behind the Welcome hero — two nested layers, exactly
 * like the web:
 *
 *  OUTER  <HeroParallax>  (src/components/landing/hero-parallax.tsx)
 *    absolute inset-0 over the hero section, scroll-SCRUBBED:
 *    gsap.to(el, { yPercent: 18, scale: 1.06, ease: 'none', scrollTrigger:
 *    { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 } }).
 *    Progress is linear in scroll (hero top at viewport top → hero bottom at
 *    viewport top); `scrub: 0.6` is GSAP's catch-up tween — expo.out over
 *    0.6s, re-targeted on every scroll update — reproduced by re-issuing a
 *    600ms expo-out withTiming on each change. Reduce Motion: no tween at all.
 *
 *  INNER  <CssGlow>  (src/components/landing/hero-glow.tsx + globals.css
 *    `.hero-glow`): a 640×640 radial-gradient(circle, accent@16%, accent@0 70%)
 *    centred at left 50% / top 33.33% of the hero, drifting on
 *    `hero-glow-drift 16s ease-in-out infinite`:
 *      0%/100%  translate3d(−6%, −2%, 0) scale(1)
 *      50%      translate3d( 6%,  4%, 0) scale(1.12)
 *    (% of its own 640px box → x ±38.4px, y −12.8 → +25.6px), each half on CSS
 *    ease-in-out. Reduce Motion: `animation: none` → static, centred, scale 1
 *    (the REST pose, not the 0% keyframe).
 *
 * The web's desktop-only WebGL noise glow (hero-glow-3d.tsx) is never served
 * to (hover: none) devices — every phone gets this CSS glow — so this is the
 * complete phone presentation, not a fallback.
 */
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  interpolate,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { EASE, useReduceMotion } from "~/lib/motion";

const SIZE = 640;
/** CSS `circle` defaults to `farthest-corner`: half the square's diagonal. */
const FARTHEST_CORNER = (SIZE / 2) * Math.SQRT2;
/** 16s keyframe = 8s out + 8s back. */
const HALF_MS = 8000;
/** hero-parallax.tsx: yPercent 18, scale 1.06, scrub 0.6. */
const PARALLAX_Y = 0.18;
const PARALLAX_SCALE = 0.06;
const SCRUB_MS = 600;

export interface HeroGlowProps {
  /** ScrollView contentOffset.y. */
  scrollY: SharedValue<number>;
  /** Hero section's content-space top and height (from its onLayout). */
  heroY: SharedValue<number>;
  heroH: SharedValue<number>;
}

/** Parallax wrapper + drifting glow. Render as the FIRST child of the hero (overflow hidden). */
export function HeroGlow({ scrollY, heroY, heroH }: HeroGlowProps) {
  const reduce = useReduceMotion();
  const p = useSharedValue(0);

  useAnimatedReaction(
    () => {
      if (reduce || heroH.value <= 0) return 0;
      const raw = (scrollY.value - heroY.value) / heroH.value;
      return Math.min(1, Math.max(0, raw));
    },
    (raw, prev) => {
      if (raw === prev) return;
      if (reduce) {
        cancelAnimation(p);
        p.value = 0;
        return;
      }
      p.value = withTiming(raw, { duration: SCRUB_MS, easing: EASE.expoOut, reduceMotion: ReduceMotion.Never });
    },
    [reduce]
  );

  // gsap matchMedia auto-revert: clear the transform when Reduce Motion turns on.
  useEffect(() => {
    if (reduce) {
      cancelAnimation(p);
      p.value = 0;
    }
  }, [reduce, p]);

  const parallax = useAnimatedStyle(() => ({
    transform: [{ translateY: p.value * PARALLAX_Y * heroH.value }, { scale: 1 + PARALLAX_SCALE * p.value }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, parallax]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <CssGlow reduce={reduce} />
    </Animated.View>
  );
}

function CssGlow({ reduce }: { reduce: boolean }) {
  const t = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(t);
    t.value = 0;
    if (reduce) return;
    t.value = withRepeat(
      withTiming(1, { duration: HALF_MS, easing: EASE.cssInOut, reduceMotion: ReduceMotion.Never }),
      -1,
      true,
      undefined,
      ReduceMotion.Never
    );
    return () => cancelAnimation(t);
  }, [reduce, t]);

  const drift = useAnimatedStyle(() => {
    if (reduce) return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    return {
      transform: [
        { translateX: interpolate(t.value, [0, 1], [-0.06 * SIZE, 0.06 * SIZE]) },
        { translateY: interpolate(t.value, [0, 1], [-0.02 * SIZE, 0.04 * SIZE]) },
        { scale: interpolate(t.value, [0, 1], [1, 1.12]) },
      ],
    };
  }, [reduce]);

  return (
    <Animated.View style={[styles.glow, drift]}>
      <Svg width={SIZE} height={SIZE}>
        <Defs>
          <RadialGradient id="heroGlow" cx={SIZE / 2} cy={SIZE / 2} r={FARTHEST_CORNER} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor="#2ECC71" stopOpacity={0.16} />
            <Stop offset={0.7} stopColor="#2ECC71" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={SIZE} height={SIZE} fill="url(#heroGlow)" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: "absolute",
    left: "50%",
    top: "33.333%",
    width: SIZE,
    height: SIZE,
    marginLeft: -SIZE / 2,
    marginTop: -SIZE / 2,
    borderRadius: SIZE / 2,
  },
});
