/**
 * UseCaseCards — port of src/components/landing/use-cases.tsx (+ auto-hover).
 *
 *   heading   : GSAP word rise (shared <HeadingReveal>), reversible.
 *   cards     : <Reveal delay={60 + i·80}> (60/140/220/300ms), exit un-staggered.
 *   card hover: identical to the feature card (200ms tw lift -6, border/bg,
 *               glow) + accent bar (300ms) + the accent title sliding right
 *               4px (translate-x-1, 200ms tw — physical, like the web).
 *   touch     : in-view auto-hover (≥60% in the 12%-inset viewport), all
 *               hover parts ("full" scope), plus press.
 *
 * Pass `heading={false}` if the screen renders the section heading itself.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useLocale, useT, rtlText, type MessageKey } from "~/i18n";
import { Reveal } from "~/components/motion/reveal";
import { HeadingReveal } from "~/components/motion/heading-reveal";
import { HoverAccentBar, HoverCard, useHoverTiming } from "~/components/motion/hover-card";

const USE_CASES: { titleKey: MessageKey; bodyKey: MessageKey }[] = [
  { titleKey: "lp.use1Title", bodyKey: "lp.use1Body" },
  { titleKey: "lp.use2Title", bodyKey: "lp.use2Body" },
  { titleKey: "lp.use3Title", bodyKey: "lp.use3Body" },
  { titleKey: "lp.use4Title", bodyKey: "lp.use4Body" },
];

/** `transition-transform duration-200 group-hover:translate-x-1` (not reduce-gated on the web). */
function NudgeTitle({ children, dir }: { children: string; dir: "ltr" | "rtl" }) {
  const p = useHoverTiming(200, EASE.tw);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: 4 * p.value }] }));
  return <Animated.Text style={[styles.title, rtlText(dir), style]}>{children}</Animated.Text>;
}

export function UseCaseCards({
  heading = true,
  style,
}: {
  heading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const { dir } = useLocale();

  return (
    <View style={[styles.section, style]}>
      {heading ? (
        <HeadingReveal text={t("lp.useCasesHeading")} style={styles.heading} lineHeight={30} align="center" />
      ) : null}
      <View style={[styles.grid, !heading && { marginTop: 0 }]}>
        {USE_CASES.map(({ titleKey, bodyKey }, i) => (
          <Reveal key={titleKey} delay={60 + i * 80}>
            <HoverCard style={styles.card} inViewScope="full" accessibilityRole="summary">
              <HoverAccentBar />
              <NudgeTitle dir={dir}>{t(titleKey)}</NudgeTitle>
              <Text style={[styles.body, rtlText(dir)]}>{t(bodyKey)}</Text>
            </HoverCard>
          </Reveal>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // max-w-5xl mx-auto px-6 py-16
  section: { width: "100%", maxWidth: 1024, alignSelf: "center", paddingHorizontal: 24, paddingVertical: 64 },
  heading: { fontSize: 24, fontWeight: "700", color: C.w },
  // mt-12 grid gap-y-10 (single column on phones)
  grid: { marginTop: 48, gap: 40 },
  // rounded-2xl border border-light bg-surface p-5
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: C.surface,
    padding: 20,
  },
  // text-base font-semibold text-accent
  title: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: C.accent },
  // mt-1.5 text-2 text-sm leading-relaxed
  body: { marginTop: 6, fontSize: 14, lineHeight: 22.75, color: C.t2 },
});
