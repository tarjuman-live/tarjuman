/**
 * FeatureCards — port of src/components/landing/features.tsx (+ the touch
 * auto-hover of auto-hover-grid.tsx, built into <HoverCard>).
 *
 *   heading   : GSAP word rise (shared <HeadingReveal>), top crossing 82%.
 *   sub       : <Reveal delay={120}>.
 *   cards     : <Reveal delay={80 + i·90}> (80/170/260/350ms), each observing
 *               its own visibility; exit un-staggered.
 *   card hover: 200ms tw — lift -6, border → accent, bg → surfaceLight, glow
 *               0 14px 36px accent@20%;
 *               accent bar scaleY 0→1 from the top, 300ms tw;
 *               icon tile scale 1.1 + rotate -3deg, 200ms tw, + its own glow
 *               0 0 20px accent@35% (web snaps the glow — faded here, 200ms,
 *               per the fluid-motion rule).
 *   touch     : iOS can't hover, so like mobile web the cards light up while
 *               ≥60% visible in the 12%-inset viewport (300ms CSS ease), and
 *               also while pressed. inViewScope "full" plays EVERY hover part
 *               on scroll (bar, icon, bg), not just mobile web's subset.
 *
 * Pass `heading={false}` if the screen renders the section heading itself.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useLocale, useT, rtlText, type MessageKey } from "~/i18n";
import { Reveal } from "~/components/motion/reveal";
import { HeadingReveal } from "~/components/motion/heading-reveal";
import { HoverAccentBar, HoverCard, useHoverTiming } from "~/components/motion/hover-card";

type IconName = "languages" | "book-open" | "waves" | "sparkles";

const FEATURES: { icon: IconName; titleKey: MessageKey; bodyKey: MessageKey }[] = [
  { icon: "languages", titleKey: "lp.feat1Title", bodyKey: "lp.feat1Body" },
  { icon: "book-open", titleKey: "lp.feat2Title", bodyKey: "lp.feat2Body" },
  { icon: "waves", titleKey: "lp.feat3Title", bodyKey: "lp.feat3Body" },
  { icon: "sparkles", titleKey: "lp.feat4Title", bodyKey: "lp.feat4Body" },
];

/** lucide-react glyphs (the web's exact icons), 24-unit viewBox, stroke 2. */
function LucideIcon({ name, size = 20, color = C.accent }: { name: IconName; size?: number; color?: string }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  let body: ReactNode;
  switch (name) {
    case "languages":
      body = (
        <>
          <Path d="m5 8 6 6" {...stroke} />
          <Path d="m4 14 6-6 2-3" {...stroke} />
          <Path d="M2 5h12" {...stroke} />
          <Path d="M7 2h1" {...stroke} />
          <Path d="m22 22-5-10-5 10" {...stroke} />
          <Path d="M14 18h6" {...stroke} />
        </>
      );
      break;
    case "book-open":
      body = (
        <>
          <Path d="M12 5v16" {...stroke} />
          <Path
            d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"
            {...stroke}
          />
        </>
      );
      break;
    case "waves":
      body = (
        <>
          <Path d="M2 12q2.5 2 5 0t5 0 5 0 5 0" {...stroke} />
          <Path d="M2 19q2.5 2 5 0t5 0 5 0 5 0" {...stroke} />
          <Path d="M2 5q2.5 2 5 0t5 0 5 0 5 0" {...stroke} />
        </>
      );
      break;
    case "sparkles":
      body = (
        <>
          <Path
            d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
            {...stroke}
          />
          <Path d="M20 2v4" {...stroke} />
          <Path d="M22 4h-4" {...stroke} />
          <Circle cx="4" cy="20" r="2" {...stroke} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

/**
 * 44px icon tile: `transition-transform duration-200 group-hover:scale-110
 * group-hover:-rotate-3 group-hover:shadow-[0_0_20px_rgba(46,204,113,0.35)]`.
 * Reduce Motion: unchanged — the web's group-hover transform is not gated.
 */
function IconTile({ name }: { name: IconName }) {
  const p = useHoverTiming(200, EASE.tw);
  const tile = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.1 * p.value }, { rotate: `${-3 * p.value}deg` }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <Animated.View style={[styles.iconTile, tile]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.iconGlow, glow]} />
      <LucideIcon name={name} />
    </Animated.View>
  );
}

export function FeatureCards({
  heading = true,
  style,
}: {
  /** Render the section heading + sub (web Features() does). */
  heading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const { dir } = useLocale();
  const text = rtlText(dir);

  return (
    <View style={[styles.section, style]}>
      {heading ? (
        <>
          <HeadingReveal text={t("lp.featuresHeading")} style={styles.heading} lineHeight={30} align="center" />
          <Reveal delay={120}>
            <Text style={[styles.sub, dir === "rtl" && { writingDirection: "rtl" }]}>{t("lp.featuresSub")}</Text>
          </Reveal>
        </>
      ) : null}
      <View style={[styles.grid, !heading && { marginTop: 0 }]}>
        {FEATURES.map(({ icon, titleKey, bodyKey }, i) => (
          <Reveal key={titleKey} delay={80 + i * 90}>
            <HoverCard style={styles.card} inViewScope="full" accessibilityRole="summary">
              <HoverAccentBar />
              <IconTile name={icon} />
              <Text style={[styles.title, text]}>{t(titleKey)}</Text>
              <Text style={[styles.body, text]}>{t(bodyKey)}</Text>
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
  // text-2xl font-bold leading-tight
  heading: { fontSize: 24, fontWeight: "700", color: C.w },
  // mt-3 text-center text-2
  sub: { marginTop: 12, textAlign: "center", color: C.t2, fontSize: 16, lineHeight: 24 },
  // mt-12 grid gap-4
  grid: { marginTop: 48, gap: 16 },
  // rounded-2xl border border-light bg-surface p-6
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: C.surface,
    padding: 24,
  },
  // w-11 h-11 rounded-xl bg-accent-soft grid place-items-center
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlow: { borderRadius: 12, boxShadow: "0 0 20px rgba(46,204,113,0.35)" },
  // mt-4 text-lg font-semibold
  title: { marginTop: 16, fontSize: 18, lineHeight: 28, fontWeight: "600", color: C.w },
  // mt-1.5 text-2 text-sm leading-relaxed
  body: { marginTop: 6, fontSize: 14, lineHeight: 22.75, color: C.t2 },
});
