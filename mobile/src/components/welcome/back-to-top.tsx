/**
 * "Back to top" — src/components/landing/back-to-top.tsx (rendered at the end
 * of the FAQ section, wrapped in <Reveal delay={60 + 6·70}>).
 *
 * Hover → press (transition duration-300, Tailwind curve (.4,0,.2,1)):
 *   pill translateY 0 → -2px, border border-light → accent, bg surface →
 *   surface-light, text text-2 → text-1, shadow → 0 10px 30px accent@18%;
 *   the ArrowUp icon nudges a further -2px (group-hover).
 *   motion-reduce: `transition-none` + no lift/nudge → colours switch
 *   instantly, nothing moves.
 * Tap: Lenis `scrollTo(0, { duration: 1.1 })` (expo-out) — instant under
 * Reduce Motion (see welcome-scroll.tsx).
 */
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle } from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import { C } from "~/lib/theme";
import { EASE, useReduceMotion } from "~/lib/motion";
import { useT } from "~/i18n";
import { usePressProgress } from "./use-press-progress";
import { useWelcomeScroll } from "./welcome-scroll";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BackToTop() {
  const t = useT();
  const reduce = useReduceMotion();
  const scroller = useWelcomeScroll();
  const { p, onPressIn, onPressOut } = usePressProgress(300, EASE.tw, reduce);

  const pill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.surface, C.surfaceLight]),
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]),
    transform: [{ translateY: reduce ? 0 : -2 * p.value }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: p.value }));
  const arrow = useAnimatedStyle(() => ({ transform: [{ translateY: reduce ? 0 : -2 * p.value }] }));
  // The icon is `currentColor`: crossfade text-2 → text-1 with the label.
  const arrowLit = useAnimatedStyle(() => ({ opacity: p.value }));
  const label = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.t2, C.w]) }));

  return (
    <View style={styles.wrap}>
      <AnimatedPressable
        accessibilityRole="button"
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => scroller?.scrollToTop()}
        style={[styles.pill, pill]}
      >
        <Animated.View pointerEvents="none" style={[styles.glow, glow]} />
        <Animated.View style={[styles.arrow, arrow]}>
          <SymbolView name="arrow.up" size={16} tintColor={C.t2} weight="semibold" />
          <Animated.View style={[StyleSheet.absoluteFill, arrowLit]}>
            <SymbolView name="arrow.up" size={16} tintColor={C.w} weight="semibold" />
          </Animated.View>
        </Animated.View>
        <Animated.Text style={[styles.label, label]}>{t("lp.backToTop")}</Animated.Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // mt-12 flex justify-center
  wrap: { marginTop: 48, alignItems: "center" },
  // inline-flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  glow: {
    position: "absolute",
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 999,
    boxShadow: "0 10px 30px rgba(46, 204, 113, 0.18)",
  },
  arrow: { width: 16, height: 16 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
