/**
 * WelcomeFooter — port of src/components/landing/footer.tsx.
 *
 *   surface : bg-gradient-to-b from-transparent to-surface (static).
 *   reveal  : the whole row sits in <Reveal> (delay 0) — rises 28px, scales
 *             .96 → 1 with the overshoot, fades; hides again on scroll-out.
 *   links   : Record / Privacy / Terms — `hover:text-accent transition-colors`
 *             → text-2 → accent while pressed, 150ms tw.
 *   contact : pill border borderLight → accent, text text-2 → accent, bg
 *             transparent → accentSoft while pressed, 150ms tw.
 *   socials : glyph text-3 → accent, translateY 0 → -2, scale 1 → 1.1 while
 *             pressed, 200ms tw (`transition-all duration-200`). Colour is a
 *             cross-fade of two stacked glyphs (grey / green).
 *   Reduce Motion: the web doesn't gate these hovers, so neither do we — the
 *   social lift/scale and colours all still play.
 *
 * The phone layout is the web's `flex-col items-center gap-6` stack.
 */
import { Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL, SOCIAL_LINKS } from "@shared/site";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useT } from "~/i18n";
import { Reveal } from "~/components/motion/reveal";

// Monochrome brand glyphs (simple-icons paths), identical to the web footer.
const SOCIALS: { labelKey: string; href: string; path: string }[] = [
  {
    labelKey: "welcome-sections.openInstagram",
    href: SOCIAL_LINKS.instagram,
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
  {
    labelKey: "welcome-sections.openX",
    href: SOCIAL_LINKS.x,
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  {
    labelKey: "welcome-sections.openTikTok",
    href: SOCIAL_LINKS.tiktok,
    path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
];

/** 0 → 1 while pressed, `duration` ms on the Tailwind curve (web :hover). */
function usePressProgress(duration: number): [SharedValue<number>, () => void, () => void] {
  const p = useSharedValue(0);
  const cfg = { duration, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
  return [p, () => (p.value = withTiming(1, cfg)), () => (p.value = withTiming(0, cfg))];
}

/** `hover:text-[var(--color-accent)] transition-colors` text link. */
function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  const [p, onIn, onOut] = usePressProgress(150);
  const color = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.t2, C.accent]) as string }));
  return (
    <Pressable accessibilityRole="link" onPress={onPress} onPressIn={onIn} onPressOut={onOut} hitSlop={8}>
      <Animated.Text style={[styles.link, color]}>{label}</Animated.Text>
    </Pressable>
  );
}

/** The mailto pill: border + text + bg tint, `transition-colors` 150ms. */
function ContactPill({ label, a11yLabel }: { label: string; a11yLabel: string }) {
  const [p, onIn, onOut] = usePressProgress(150);
  const pill = useAnimatedStyle(() => ({
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]) as string,
    backgroundColor: interpolateColor(p.value, [0, 1], ["rgba(46,204,113,0)", C.accentSoft]) as string,
  }));
  const text = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.t2, C.accent]) as string }));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={a11yLabel}
      onPress={() => void Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
      onPressIn={onIn}
      onPressOut={onOut}
    >
      <Animated.View style={[styles.pill, pill]}>
        <Animated.Text style={[styles.link, text]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/** Social glyph: colour + lift -2 + scale 1.1, `transition-all duration-200`. */
function SocialIcon({ label, href, path }: { label: string; href: string; path: string }) {
  const [p, onIn, onOut] = usePressProgress(200);
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -2 * p.value }, { scale: 1 + 0.1 * p.value }],
  }));
  const green = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void WebBrowser.openBrowserAsync(href)}
      onPressIn={onIn}
      onPressOut={onOut}
      hitSlop={12}
    >
      <Animated.View style={[styles.icon, lift]}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path d={path} fill={C.t3} />
        </Svg>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, green]}>
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d={path} fill={C.accent} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export function WelcomeFooter({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useT();
  const router = useRouter();

  return (
    <View style={[styles.footer, style]}>
      {/* soft fade from the page background into the footer surface */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(14,21,37,0)", C.surface]}
        style={StyleSheet.absoluteFill}
      />
      <Reveal>
        <View style={styles.inner}>
          <Text style={styles.brand}>{SITE_NAME}</Text>

          <View style={styles.navCol}>
            <View style={styles.nav}>
              {/* Signed out (the only place the welcome screen shows): the
                  web's /record gate sends you to sign in. */}
              <FooterLink label={t("nav.record")} onPress={() => router.push("/sign-in")} />
              <FooterLink
                label={t("lp.privacy")}
                onPress={() => void WebBrowser.openBrowserAsync(`${SITE_URL}/privacy`)}
              />
              <FooterLink label={t("lp.terms")} onPress={() => void WebBrowser.openBrowserAsync(`${SITE_URL}/terms`)} />
              <ContactPill label={t("lp.contact")} a11yLabel={t("welcome-sections.contactA11y")} />
            </View>

            <View style={styles.socials}>
              {SOCIALS.map((s) => (
                <SocialIcon key={s.labelKey} label={t(s.labelKey)} href={s.href} path={s.path} />
              ))}
            </View>
          </View>
        </View>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { width: "100%", position: "relative" },
  // max-w-5xl mx-auto px-6 py-12 flex-col items-center gap-6
  inner: {
    width: "100%",
    maxWidth: 1024,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: "center",
    gap: 24,
  },
  brand: { fontSize: 16, fontWeight: "700", color: C.w },
  navCol: { alignItems: "center", gap: 24 },
  // flex items-center gap-6 text-sm
  nav: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 24 },
  link: { fontSize: 14, lineHeight: 20, color: C.t2 },
  // px-4 py-1.5 rounded-full border
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  // flex items-center gap-4
  socials: { flexDirection: "row", alignItems: "center", gap: 16 },
  icon: { width: 20, height: 20 },
});
