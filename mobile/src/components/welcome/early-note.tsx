/**
 * EarlyNote — src/components/landing/early-note.tsx, the honest early-stage
 * trust band.
 *
 *   <HeadingReveal> "lp.earlyHeading"   — GSAP word rise at 'top 82%', reverses
 *   <Reveal delay={90}> card            — rise 28 + scale .96 → 1 (overshoot),
 *                                         fade 600ms, two-way
 *   card hover → press (transition duration-200, (.4,0,.2,1)):
 *     translateY -4px, border border-light → accent, bg surface →
 *     surface-light, shadow → 0 10px 30px accent@18%.
 *     NOT a [data-hovercard] on the web, so no scroll auto-hover on phones
 *     (touchInView={false}).
 *   <TryItFree> inside it has its own invert/lift, and pressing it lights
 *   the card too (on the web, hovering the button hovers the card).
 * Accessibility: the web card is a plain div, so VoiceOver reaches the
 * heading, body and button separately. The card is therefore a
 * NON-interactive HoverCard. An inner non-grouping HoverPressable
 * (accessible={false}) carries the padding and drives the press lift.
 */
import { StyleSheet, Text, View } from "react-native";
import { C } from "~/lib/theme";
import { useT } from "~/i18n";
import { HeadingReveal } from "~/components/motion/heading-reveal";
import { Reveal } from "~/components/motion/reveal";
import { HoverCard, HoverPressable } from "~/components/motion/hover-card";
import { TryItFree } from "./try-it-free";

export function EarlyNote({ wide = false }: { wide?: boolean }) {
  const t = useT();
  return (
    // section: w-full max-w-5xl mx-auto px-6 py-16 (sm:py-24)
    <View style={[styles.section, wide && styles.sectionWide]}>
      <HeadingReveal text={t("lp.earlyHeading")} style={[styles.h2, wide && styles.h2Wide]} lineHeight={wide ? 37.5 : 30} />
      <Reveal delay={90} style={styles.revealWrap}>
        <HoverCard
          style={styles.card}
          lift={-4}
          glow="0 10px 30px rgba(46, 204, 113, 0.18)"
          pressMs={200}
          touchInView={false}
          interactive={false}
        >
          <HoverPressable accessible={false} style={[styles.inner, wide && styles.innerWide]}>
            <Text style={[styles.launched, wide && styles.launchedWide]}>{t("lp.earlyLaunched")}</Text>
            <Text style={styles.body}>{t("lp.earlyBody")}</Text>
            <View style={styles.cta}>
              <TryItFree />
            </View>
            <Text style={styles.foot}>{t("lp.earlyFootnote")}</Text>
          </HoverPressable>
        </HoverCard>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { width: "100%", maxWidth: 1024, alignSelf: "center", paddingHorizontal: 24, paddingVertical: 64 },
  sectionWide: { paddingVertical: 96 },
  // text-2xl sm:text-3xl font-bold text-center leading-tight
  h2: { color: C.w, fontSize: 24, fontWeight: "700" },
  h2Wide: { fontSize: 30 },
  // mt-10 mx-auto max-w-2xl
  revealWrap: { marginTop: 40, width: "100%", maxWidth: 672, alignSelf: "center" },
  // rounded-2xl border bg-surface p-8 sm:p-10 text-center
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: C.surface,
  },
  // p-8 sm:p-10 — on the inner press surface so the whole card face is pressable.
  inner: { padding: 32, alignItems: "center" },
  innerWide: { padding: 40 },
  // text-lg sm:text-xl font-semibold text-1 leading-relaxed
  launched: { color: C.w, fontSize: 18, lineHeight: 29.25, fontWeight: "600", textAlign: "center" },
  launchedWide: { fontSize: 20, lineHeight: 32.5 },
  // mt-3 text-2 leading-relaxed
  body: { marginTop: 12, color: C.t2, fontSize: 16, lineHeight: 26, textAlign: "center" },
  // mt-7 flex justify-center
  cta: { marginTop: 28, alignItems: "center" },
  // mt-7 text-xs text-4
  foot: { marginTop: 28, color: C.t4, fontSize: 12, lineHeight: 16, textAlign: "center" },
});
