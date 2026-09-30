/**
 * "Try it free" — src/components/landing/try-it-free.tsx (hero CTA row and
 * the EarlyNote card).
 *
 * Web hover/focus state (JS-driven, so a touch tap shows it too) inverts and
 * lifts the button:
 *   background accent → #0A0F1C, text #0A0F1C → accent, transform none →
 *   translateY(-3px); `transition: background-color 200ms ease, color 200ms
 *   ease, transform 200ms ease` (CSS `ease`). The 1px accent border and the
 *   0 0 24px accent@35% glow stay constant, so the size never changes. No
 *   press-scale. Not gated by reduced motion on the web.
 * Native: the same state while pressed. Inside a HoverCard (the EarlyNote
 * card) the press also lights the card, since hovering the button hovers
 * its card on the web. Opens the auth popup in sign-UP mode, as the web does.
 */
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useHoverProgress } from "~/components/motion/hover-card";
import { useT } from "~/i18n";
import { usePressProgress } from "./use-press-progress";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const INK = "#0A0F1C";

export function TryItFree({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useT();
  const router = useRouter();
  const { p, onPressIn, onPressOut } = usePressProgress(200, EASE.css);
  const card = useHoverProgress();

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.accent, INK]),
    transform: [{ translateY: -3 * p.value }],
  }));
  const label = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [INK, C.accent]),
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPressIn={() => {
        onPressIn();
        card?.pressIn();
      }}
      onPressOut={() => {
        onPressOut();
        card?.pressOut();
      }}
      onPress={() => router.push({ pathname: "/sign-in", params: { mode: "signUp" } })}
      style={[styles.btn, style, box]}
    >
      <Animated.Text style={[styles.label, label]}>{t("lp.tryFree")}</Animated.Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // mt-2 px-6 py-3 rounded-xl font-bold; border 1px accent; glow 0 0 24px accent@35%
  btn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.accent,
    boxShadow: "0 0 24px rgba(46, 204, 113, 0.35)",
    alignItems: "center",
  },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "700" },
});
