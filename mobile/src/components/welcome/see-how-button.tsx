/**
 * "See how it works" — the hero's secondary CTA (src/app/page.tsx:73-78,
 * `<a href="#features">`).
 *
 * Web hover (transition-all duration-200, Tailwind curve (.4,0,.2,1)):
 *   bg transparent → accent, text text-2 → #0A0F1C, border border-light →
 *   accent, translateY 0 → -2px, shadow → 0 0 28px accent@50%.
 * Native: the same, while pressed. The tap runs the Lenis anchor scroll to
 * the features section (see welcome-scroll.tsx).
 */
import { Pressable, StyleSheet } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle } from "react-native-reanimated";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useT } from "~/i18n";
import { usePressProgress } from "./use-press-progress";
import { useWelcomeScroll } from "./welcome-scroll";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const INK = "#0A0F1C";

export function SeeHowButton() {
  const t = useT();
  const scroller = useWelcomeScroll();
  const { p, onPressIn, onPressOut } = usePressProgress(200, EASE.tw);

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], ["rgba(46, 204, 113, 0)", C.accent]),
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]),
    transform: [{ translateY: -2 * p.value }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: p.value }));
  const label = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.t2, INK]),
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => scroller?.scrollToSection("features")}
      style={[styles.btn, box]}
    >
      <Animated.View pointerEvents="none" style={[styles.glow, glow]} />
      <Animated.Text style={[styles.label, label]}>{t("lp.seeHow")}</Animated.Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // px-5 py-3 rounded-xl font-semibold border
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  // hover:shadow-[0_0_28px_rgba(46,204,113,0.5)] — faded in (outset only, so it never covers the fill).
  glow: {
    position: "absolute",
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 12,
    boxShadow: "0 0 28px rgba(46, 204, 113, 0.5)",
  },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600" },
});
