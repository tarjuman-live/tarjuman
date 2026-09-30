/**
 * FaqItem — port of src/components/landing/faq-item.tsx: a disclosure row that
 * opens and closes fluidly (the web's grid-template-rows 0fr ↔ 1fr glide).
 *
 *   height  : <Collapsible> 300ms ease-out (bezier(0,0,.2,1)); the answer
 *             stays mounted and clipped, so open AND close animate.
 *   chevron : rotate 0 → 180deg, 300ms tw.
 *   row     : open (held) or pressed (web :hover) → border → accent, bg →
 *             surfaceLight, glow 0 10px 30px accent@18%, 300ms tw; no lift.
 *   Reduce Motion: height + chevron instant (motion-reduce:transition-none);
 *   the colour highlight still transitions (the web doesn't gate it).
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { C } from "~/lib/theme";
import { EASE, useReduceMotion } from "~/lib/motion";
import { useLocale, useT, rtlText, type MessageKey } from "~/i18n";
import { Collapsible } from "~/components/motion/collapsible";
import { HoverCard, HoverPressable } from "~/components/motion/hover-card";

const FAQ_GLOW = "0 10px 30px rgba(46, 204, 113, 0.18)";

export interface FaqItemProps {
  qKey: MessageKey;
  aKey: MessageKey;
  /** Start expanded (default false). */
  defaultOpen?: boolean;
}

function Chevron({ open, reduce }: { open: boolean; reduce: boolean }) {
  const r = useSharedValue(open ? 180 : 0);
  useEffect(() => {
    r.value = withTiming(open ? 180 : 0, {
      duration: reduce ? 0 : 300,
      easing: EASE.tw,
      reduceMotion: ReduceMotion.Never,
    });
  }, [open, reduce, r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Animated.View style={[styles.chevron, style]}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path d="m6 9 6 6 6-6" stroke={C.t3} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

export function FaqItem({ qKey, aKey, defaultOpen = false }: FaqItemProps) {
  const t = useT();
  const { dir } = useLocale();
  const reduce = useReduceMotion();
  const [open, setOpen] = useState(defaultOpen);
  const question = t(qKey);

  return (
    // The row is a plain container (web: the outer <div>, which owns the
    // hover highlight). Only the question header is the control (web: the
    // <button aria-expanded>), so VoiceOver reads the answer as its own
    // element once open, and tapping the answer text does not collapse it.
    <HoverCard
      style={styles.row}
      interactive={false}
      active={open}
      lift={0}
      glow={FAQ_GLOW}
      pressMs={300}
      touchInView={false}
    >
      {/* The web's page layout stays LTR; only the text follows the locale
          (dir="auto"), so the chevron keeps its physical side. */}
      <HoverPressable
        style={styles.header}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={question}
        accessibilityHint={t("welcome-sections.faqToggleHint")}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.question, rtlText(dir)]}>{question}</Text>
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Chevron open={open} reduce={reduce} />
        </View>
      </HoverPressable>
      {/* Collapsed answers stay mounted (the height glide needs them), so hide
          them from VoiceOver while closed — web: the clipped 0fr panel. */}
      <View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <Collapsible open={open}>
          <Text style={[styles.answer, rtlText(dir)]}>{t(aKey)}</Text>
        </Collapsible>
      </View>
    </HoverCard>
  );
}

const styles = StyleSheet.create({
  // rounded-2xl border (colours animated by HoverCard)
  row: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: C.surface,
  },
  // flex items-center justify-between gap-4 px-5 py-4
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  // text-base font-medium
  question: { flex: 1, fontSize: 16, lineHeight: 24, fontWeight: "500", color: C.w },
  chevron: { width: 20, height: 20, flexShrink: 0 },
  // px-5 pb-5 text-2 text-sm leading-relaxed
  answer: { paddingHorizontal: 20, paddingBottom: 20, fontSize: 14, lineHeight: 22.75, color: C.t2 },
});
