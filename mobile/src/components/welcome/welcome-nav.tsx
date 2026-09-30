/**
 * WelcomeNav — src/components/landing/marketing-nav.tsx, the floating glass
 * "island" nav of the landing page (signed-out variant; Welcome never renders
 * for signed-in users).
 *
 * Every web motion, mapped:
 *  - Scroll frost (transition-all duration-300, (.4,0,.2,1)) when scrollY > 8:
 *      bg rgba(14,21,37,.42) → .7, border border-faint → border-light,
 *      shadow 0 6px 20px rgba(0,0,0,.22) + inset 0 1px 0 white@5%
 *          → 0 12px 34px rgba(0,0,0,.4) + inset 0 1px 0 white@6%.
 *    backdrop blur(18px) saturate(160%) is static (BlurView; saturate has no
 *    native equivalent).
 *  - Brand tile group-hover:scale-105 (transition-transform 150ms) → press.
 *    The web brand is <Link href="/"> on this same page: Lenis only
 *    intercepts hash links, so Next's layout-router jumps to the top
 *    INSTANTLY (scrollTop = 0) — no eased scroll. Tap = jumpToTop().
 *  - Section anchors (hidden md:flex → only ≥768pt, e.g. iPad): text-2 →
 *    accent (transition-colors 150ms) → press; tap = Lenis anchor scroll.
 *  - "Sign in" ghost (hidden sm:inline-block → only ≥640pt): text-2 → accent,
 *    150ms → press.
 *  - "Get started" (transition-all duration-200): hover brightness 1.1,
 *    -2px lift, glow 0 0 20px accent@30% → 0 0 30px accent@60%; AND
 *    active:scale-95 — on a phone the press shows both at once.
 *  - LocaleSwitcher pill: its own lit-glow (shared component).
 * Not gated by reduced motion on the web (CSS transitions only).
 */
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Line, Path, Rect } from "react-native-svg";
import { SITE_NAME } from "@shared/site";
import type { MessageKey } from "@shared/i18n/messages";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useT } from "~/i18n";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { usePressProgress } from "./use-press-progress";
import { useWelcomeScroll, type WelcomeSectionId } from "./welcome-scroll";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const INK = "#0A0F1C";

/** Web: header pt-3 (12) + nav h-14 (56). */
export const NAV_TOP_GAP = 12;
export const NAV_HEIGHT = 56;

/**
 * marketing-nav LINKS minus "#pricing" (SHOW_PRICING is localhost-only). "#try"
 * is always there: the #try section always renders (its card falls back to
 * TryLive's "unsupported" state when the build has no on-device recognizer,
 * like the web in a browser without Web Speech).
 */
const LINKS: { id: WelcomeSectionId; key: MessageKey }[] = [
  { id: "features", key: "lp.features" },
  { id: "useCases", key: "lp.useCases" },
  { id: "faq", key: "lp.faq" },
];

export function WelcomeNav() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scroller = useWelcomeScroll();
  const router = useRouter();
  const t = useT();
  const sm = width >= 640;
  const md = width >= 768;

  // ── Scroll frost ──
  const frost = useSharedValue(0);
  const scrollY = scroller?.scrollY;
  useAnimatedReaction(
    () => (scrollY ? scrollY.value > 8 : false),
    (on, prev) => {
      if (on === prev || (prev === null && !on)) return;
      frost.value = withTiming(on ? 1 : 0, { duration: 300, easing: EASE.tw, reduceMotion: ReduceMotion.Never });
    }
  );
  const navBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(frost.value, [0, 1], [C.border, C.borderLight]),
  }));
  const tint = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(frost.value, [0, 1], ["rgba(14, 21, 37, 0.42)", "rgba(14, 21, 37, 0.7)"]),
  }));
  const restLayer = useAnimatedStyle(() => ({ opacity: 1 - frost.value }));
  const frostLayer = useAnimatedStyle(() => ({ opacity: frost.value }));

  return (
    <View pointerEvents="box-none" style={[styles.header, { top: insets.top + NAV_TOP_GAP }]}>
      <Animated.View style={[styles.nav, navBorder]}>
        {/* Drop shadows (crossfaded; outset only). */}
        <Animated.View pointerEvents="none" style={[styles.shadowLayer, { boxShadow: "0 6px 20px rgba(0, 0, 0, 0.22)" }, restLayer]} />
        <Animated.View pointerEvents="none" style={[styles.shadowLayer, { boxShadow: "0 12px 34px rgba(0, 0, 0, 0.4)" }, frostLayer]} />
        {/* Glass: blur + tint + inset top catch-light. */}
        <View pointerEvents="none" style={styles.clip}>
          <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
          <Animated.View style={[StyleSheet.absoluteFill, tint]} />
          <Animated.View style={[StyleSheet.absoluteFill, styles.inset5, restLayer]} />
          <Animated.View style={[StyleSheet.absoluteFill, styles.inset6, frostLayer]} />
        </View>

        <View style={[styles.row, sm && styles.rowSm]}>
          <Brand onPress={() => scroller?.jumpToTop()} label={t("welcomeHero.brandHome")} />

          {md ? (
            <View style={styles.links}>
              {LINKS.map((l) => (
                <NavLink key={l.id} label={t(l.key)} onPress={() => scroller?.scrollToSection(l.id)} />
              ))}
            </View>
          ) : null}

          <View style={[styles.actions, sm && styles.actionsSm]}>
            <LocaleSwitcher variant="pill" />
            {sm ? (
              <GhostSignIn
                label={t("lp.signIn")}
                onPress={() => router.push({ pathname: "/sign-in", params: { mode: "signIn" } })}
              />
            ) : null}
            <GetStarted
              label={t("lp.getStarted")}
              onPress={() => router.push({ pathname: "/sign-in", params: { mode: "signUp" } })}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** Brand: 36px accent mic tile (static glow 0 0 24px accent@40%) + wordmark; tile scales 1.05 on press. */
function Brand({ onPress, label }: { onPress: () => void; label: string }) {
  const { p, onPressIn, onPressOut } = usePressProgress(150, EASE.tw);
  const tile = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.05 * p.value }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={styles.brand}
    >
      <Animated.View style={[styles.logo, tile]}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round">
          <Rect x={9} y={2} width={6} height={12} rx={3} />
          <Path d="M5 10a7 7 0 0014 0" />
          <Line x1={12} y1={20} x2={12} y2={24} />
        </Svg>
      </Animated.View>
      <Text style={styles.wordmark}>{SITE_NAME}</Text>
    </Pressable>
  );
}

/** Section anchor / ghost sign-in: text colour text-2 → accent, 150ms. */
function ColorLink({ label, onPress, style }: { label: string; onPress: () => void; style?: object }) {
  const { p, onPressIn, onPressOut } = usePressProgress(150, EASE.tw);
  const color = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.t2, C.accent]) }));
  return (
    <Pressable accessibilityRole="button" onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} hitSlop={8}>
      <Animated.Text style={[style, color]}>{label}</Animated.Text>
    </Pressable>
  );
}

function NavLink(props: { label: string; onPress: () => void }) {
  return <ColorLink {...props} style={styles.linkText} />;
}

function GhostSignIn({ label, onPress }: { label: string; onPress: () => void }) {
  // px-3 py-2 rounded-xl text-sm font-semibold
  return (
    <View style={styles.ghost}>
      <ColorLink label={label} onPress={onPress} style={styles.ghostText} />
    </View>
  );
}

/** Primary CTA — hover (brightness/lift/glow) + active:scale-95, one 200ms (.4,0,.2,1) transition. */
function GetStarted({ label, onPress }: { label: string; onPress: () => void }) {
  const { p, onPressIn, onPressOut } = usePressProgress(200, EASE.tw);
  const box = useAnimatedStyle(() => ({
    // brightness(1.1) of #2ECC71 = rgb(51, 224, 124)
    backgroundColor: interpolateColor(p.value, [0, 1], [C.accent, "rgb(51, 224, 124)"]),
    transform: [{ translateY: -2 * p.value }, { scale: 1 - 0.05 * p.value }],
  }));
  const rest = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const lit = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={[styles.cta, box]}
    >
      <Animated.View pointerEvents="none" style={[styles.ctaGlow, { boxShadow: "0 0 20px rgba(46, 204, 113, 0.3)" }, rest]} />
      <Animated.View pointerEvents="none" style={[styles.ctaGlow, { boxShadow: "0 0 30px rgba(46, 204, 113, 0.6)" }, lit]} />
      <Text style={styles.ctaText}>{label}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // sticky top-0 px-3 pt-3 — floated over the ScrollView natively.
  header: { position: "absolute", left: 0, right: 0, paddingHorizontal: 12, alignItems: "center", zIndex: 50 },
  // max-w-5xl rounded-2xl h-14 border
  nav: {
    width: "100%",
    maxWidth: 1024,
    height: NAV_HEIGHT,
    borderRadius: 16,
    borderWidth: 1,
  },
  shadowLayer: { position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 16 },
  clip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 15, overflow: "hidden" },
  inset5: { borderRadius: 15, boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)" },
  inset6: { borderRadius: 15, boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)" },
  // px-3.5 sm:px-5 flex items-center justify-between gap-4
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 14,
  },
  rowSm: { paddingHorizontal: 20 },
  // flex items-center gap-2.5
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 },
  // w-9 h-9 rounded-xl bg-accent shadow-[0_0_24px_rgba(46,204,113,0.4)]
  logo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 24px rgba(46, 204, 113, 0.4)",
  },
  wordmark: { color: C.w, fontSize: 16, fontWeight: "700" },
  // gap-7 text-sm text-2
  links: { flexDirection: "row", alignItems: "center", gap: 28 },
  linkText: { fontSize: 14, lineHeight: 20 },
  // flex items-center gap-2 sm:gap-3 shrink-0
  actions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  actionsSm: { gap: 12 },
  ghost: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  ghostText: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  // px-4 py-2 rounded-xl text-sm font-bold bg-accent text-[#0A0F1C]
  cta: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  ctaGlow: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12 },
  ctaText: { color: INK, fontSize: 14, lineHeight: 20, fontWeight: "700" },
});
