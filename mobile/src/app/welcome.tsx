/**
 * Welcome — the signed-out entry screen: the web landing page (src/app/page.tsx)
 * at phone widths, with every one of its motions.
 *
 * Section order = the web on a phone (single column):
 *   MarketingNav (floating glass island)
 *   Hero: eyebrow · h1 · subhead · CTAs · fine print (RotatingText), then the
 *         LiveDemo card below — over HeroParallax(HeroGlow)
 *   (#try — the web's no-signup "Try it live" trial — is intentionally NOT
 *   ported: the user scoped the trial out of the app on 2026-09-29. The
 *   nav link to it is dropped with it; "Try it free" opens sign-up.)
 *   Features · UseCases · [Pricing: SHOW_PRICING is localhost-only] ·
 *   EarlyNote · FAQ (+ Back to top) · Footer
 *
 * Motion inventory handled here:
 *   - Hero stagger: <Reveal fade={false}> at 0 / 90 / 180 / 270 / 350ms
 *     (transform-only, two-way), LiveDemo <Reveal delay={220}> (with fade).
 *   - HeroGlow drift + HeroParallax scrub (hero-glow.tsx).
 *   - Lenis: programmatic scrolls only (welcome-scroll.tsx); the user's own
 *     scrolling is native momentum, exactly like the web on touch
 *     (`syncTouch: false`).
 *   - Back to top: <Reveal delay={60 + 6·70}> inside <Faq> (faq.tsx) +
 *     back-to-top.tsx.
 * Layout: the web header is `sticky` IN FLOW (68px: pt-3 + h-14), so the hero
 * starts 68px down and the parallax only starts after 68px of scroll
 * (`start: 'top top'`). Natively the nav floats; a spacer of the same height
 * (+ the status-bar inset) keeps both the layout and the scroll mapping.
 */
import { useCallback, type ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "~/lib/theme";
import { useT } from "~/i18n";
import { Reveal, RevealScrollView, useRevealScroll } from "~/components/motion/reveal";
import { HeroGlow } from "~/components/welcome/hero-glow";
import { RotatingText } from "~/components/welcome/rotating-text";
import { TryItFree } from "~/components/welcome/try-it-free";
import { SeeHowButton } from "~/components/welcome/see-how-button";
import { EarlyNote } from "~/components/welcome/early-note";
import { BackToTop } from "~/components/welcome/back-to-top";
import { NAV_HEIGHT, NAV_TOP_GAP, WelcomeNav } from "~/components/welcome/welcome-nav";
import {
  useWelcomeScroll,
  useWelcomeScrollerState,
  WelcomeScrollDriver,
  WelcomeScrollProvider,
  type WelcomeSectionId,
} from "~/components/welcome/welcome-scroll";
// Built by the welcome-sections builder (fixed names).
import { LiveDemo } from "~/components/welcome/live-demo";
import { FeatureCards } from "~/components/welcome/feature-cards";
import { UseCaseCards } from "~/components/welcome/use-case-cards";
import { Faq } from "~/components/welcome/faq";
import { WelcomeFooter } from "~/components/welcome/footer";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const sm = width >= 640;
  const navBottom = insets.top + NAV_TOP_GAP + NAV_HEIGHT;
  const scroller = useWelcomeScrollerState(navBottom);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => scroller.setViewportHeight(e.nativeEvent.layout.height),
    [scroller]
  );
  const onContentSizeChange = useCallback((_w: number, h: number) => scroller.setContentHeight(h), [scroller]);

  return (
    <WelcomeScrollProvider value={scroller}>
      <View style={styles.screen}>
        <RevealScrollView
          onScrollBeginDrag={scroller.cancel}
          onLayout={onLayout}
          onContentSizeChange={onContentSizeChange}
          contentContainerStyle={{ paddingBottom: insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* The web's in-flow sticky header slot. */}
          <View style={{ height: navBottom }} />

          <Hero sm={sm} />

          <Section id="features">
            <FeatureCards />
          </Section>
          <Section id="useCases">
            <UseCaseCards />
          </Section>
          <EarlyNote wide={sm} />
          <Section id="faq">
            {/* faq.tsx: the BackToTop pill sits inside the FAQ section, after
                the rows, in <Reveal delay={60 + 6·70}> (480ms). */}
            <Faq>
              <Reveal delay={Faq.backToTopDelay}>
                <BackToTop />
              </Reveal>
            </Faq>
          </Section>
          <WelcomeFooter />

          <WelcomeScrollDriver />
        </RevealScrollView>

        <WelcomeNav />
      </View>
    </WelcomeScrollProvider>
  );
}

/** Records a section's content-space top for the Lenis anchor jumps. */
function Section({ id, children }: { id: WelcomeSectionId; children: ReactNode }) {
  const scroller = useWelcomeScroll();
  return <View onLayout={(e) => scroller?.setSection(id, e.nativeEvent.layout.y)}>{children}</View>;
}

function Hero({ sm }: { sm: boolean }) {
  const t = useT();
  const ctx = useRevealScroll();
  const heroY = useSharedValue(0);
  const heroH = useSharedValue(0);
  const fallbackY = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => {
    heroY.value = e.nativeEvent.layout.y;
    heroH.value = e.nativeEvent.layout.height;
  };

  const rotating = [
    t("welcomeHero.rotArabic"),
    t("welcomeHero.rotUrdu"),
    t("welcomeHero.rotSpanish"),
    t("welcomeHero.rotFrench"),
    t("welcomeHero.rotTurkish"),
    t("welcomeHero.rotIndonesian"),
  ];
  const leadText = t("welcomeHero.finePrintLead");
  const tailText = t("welcomeHero.finePrintTail");
  const lead = leadText.split(" ").filter(Boolean);
  const tail = tailText.split(" ").filter(Boolean);

  return (
    // relative overflow-hidden px-6 pt-24 pb-16 sm:pt-28 sm:pb-24
    <View onLayout={onLayout} style={[styles.hero, sm && styles.heroSm]}>
      <HeroGlow scrollY={ctx?.scrollY ?? fallbackY} heroY={heroY} heroH={heroH} />

      {/* grid gap-14: pitch column, then the demo */}
      <View style={styles.heroGrid}>
        {/* flex-col items-center text-center gap-6 */}
        <View style={styles.pitch}>
          <Reveal delay={0} fade={false} style={styles.heroItem}>
            <View style={styles.eyebrow}>
              <Text style={styles.eyebrowText}>✦ {t("lp.heroEyebrow")}</Text>
            </View>
          </Reveal>

          <Reveal delay={90} fade={false} style={styles.heroItem}>
            <Text accessibilityRole="header" style={[styles.h1, sm && styles.h1Sm]}>
              {t("lp.heroTitle")}
            </Text>
          </Reveal>

          <Reveal delay={180} fade={false} style={styles.heroItem}>
            <Text style={[styles.subhead, sm && styles.subheadSm]}>{t("lp.heroSubhead")}</Text>
          </Reveal>

          <Reveal delay={270} fade={false} style={styles.heroItem}>
            {/* flex flex-col sm:flex-row items-center gap-3 */}
            <View style={[styles.ctaRow, sm && styles.ctaRowSm]}>
              <TryItFree />
              <SeeHowButton />
            </View>
          </Reveal>

          <Reveal delay={350} fade={false} style={styles.heroItem}>
            {/* text-xs text-4 — one wrapping line with the slot-roll inline */}
            {/* One VoiceOver element, like the web's single <p> (the rolling
                slot reads as its first word, the web's aria-label). */}
            <View
              style={styles.finePrint}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${leadText} ${rotating[0]} ${tailText}`}
            >
              {lead.map((w, i) => (
                <Text key={`l${i}`} style={styles.fine}>
                  {w}
                </Text>
              ))}
              <RotatingText items={rotating} fontSize={12} style={styles.rotating} />
              {tail.map((w, i) => (
                <Text key={`t${i}`} style={styles.fine}>
                  {w}
                </Text>
              ))}
            </View>
          </Reveal>
        </View>

        <Reveal delay={220} style={styles.demo}>
          <LiveDemo />
        </Reveal>
      </View>
    </View>
  );
}

const FINE = 12;
const FINE_ROW = FINE * 1.35;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  hero: { overflow: "hidden", paddingHorizontal: 24, paddingTop: 96, paddingBottom: 64 },
  heroSm: { paddingTop: 112, paddingBottom: 96 },
  heroGrid: { width: "100%", maxWidth: 1152, alignSelf: "center", gap: 56 },
  pitch: { alignItems: "center", gap: 24 },
  // HERO_ITEM = "w-full flex flex-col items-center"
  heroItem: { alignSelf: "stretch", alignItems: "center" },

  // inline-flex gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-accent-soft text-accent border-accent/30
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: "rgba(46, 204, 113, 0.3)",
  },
  eyebrowText: { color: C.accent, fontSize: 12, lineHeight: 16, fontWeight: "600" },

  // text-3xl sm:text-5xl font-bold max-w-xl leading-[1.1]
  h1: { maxWidth: 576, color: C.w, fontSize: 30, lineHeight: 33, fontWeight: "700", textAlign: "center" },
  h1Sm: { fontSize: 48, lineHeight: 52.8 },
  // max-w-md text-2 text-base sm:text-lg leading-relaxed
  subhead: { maxWidth: 448, color: C.t2, fontSize: 16, lineHeight: 26, textAlign: "center" },
  subheadSm: { fontSize: 18, lineHeight: 29.25 },

  ctaRow: { flexDirection: "column", alignItems: "center", gap: 12 },
  ctaRowSm: { flexDirection: "row" },

  finePrint: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "flex-end",
    columnGap: FINE * 0.25,
  },
  fine: { color: C.t4, fontSize: FINE, lineHeight: FINE_ROW },
  // font-semibold text-accent
  rotating: { color: C.accent, fontWeight: "600" },

  // w-full flex justify-center
  demo: { width: "100%", alignItems: "center" },
});
