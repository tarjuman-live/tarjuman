/**
 * Faq — port of src/components/landing/faq.tsx.
 *
 *   heading : GSAP word rise (shared <HeadingReveal>), reversible.
 *   rows    : <Reveal delay={60 + i·70}> (60/130/200/270/340/410ms), each a
 *             fluid <FaqItem> accordion. Rows below an opening answer are
 *             pushed down by the height glide; the Reveal/in-view observers
 *             re-measure on every layout change (RevealScrollView layoutTick).
 *   children: rendered after the rows inside the section — the web puts
 *             <Reveal delay={60 + 6·70}><BackToTop/></Reveal> there, so pass
 *             the welcome screen's back-to-top pill as children (use
 *             `Faq.backToTopDelay` for its Reveal delay).
 *
 * Pass `heading={false}` if the screen renders the section heading itself.
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "~/lib/theme";
import { useT, type MessageKey } from "~/i18n";
import { Reveal } from "~/components/motion/reveal";
import { HeadingReveal } from "~/components/motion/heading-reveal";
import { FaqItem } from "./faq-item";

const FAQ_KEYS: { qKey: MessageKey; aKey: MessageKey }[] = [
  { qKey: "lp.faqQ1", aKey: "lp.faqA1" },
  { qKey: "lp.faqQ2", aKey: "lp.faqA2" },
  { qKey: "lp.faqQ3", aKey: "lp.faqA3" },
  { qKey: "lp.faqQ4", aKey: "lp.faqA4" },
  { qKey: "lp.faqQ5", aKey: "lp.faqA5" },
  { qKey: "lp.faqQ6", aKey: "lp.faqA6" },
];

export function Faq({
  heading = true,
  children,
  style,
}: {
  heading?: boolean;
  /** Slot after the rows (web: the BackToTop pill). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  return (
    <View style={[styles.section, style]}>
      {heading ? (
        <HeadingReveal text={t("lp.faqHeading")} style={styles.heading} lineHeight={30} align="center" />
      ) : null}
      <View style={[styles.list, !heading && { marginTop: 0 }]}>
        {FAQ_KEYS.map(({ qKey, aKey }, i) => (
          <Reveal key={qKey} delay={60 + i * 70}>
            <FaqItem qKey={qKey} aKey={aKey} />
          </Reveal>
        ))}
      </View>
      {children}
    </View>
  );
}

/** Reveal delay the web gives the BackToTop pill after the last row (480ms). */
Faq.backToTopDelay = 60 + FAQ_KEYS.length * 70;

const styles = StyleSheet.create({
  // max-w-3xl mx-auto px-6 py-16
  section: { width: "100%", maxWidth: 768, alignSelf: "center", paddingHorizontal: 24, paddingVertical: 64 },
  heading: { fontSize: 24, fontWeight: "700", color: C.w },
  // mt-10 flex flex-col gap-3
  list: { marginTop: 40, gap: 12 },
});
