/**
 * SummaryLoading — mirror of src/components/session/summary-loading.tsx: the
 * "summary forming" card shown between Generate and the first streamed token.
 *
 *   caption rotation : every 2200ms, i = (i + 1) % 3 (held on the first
 *                      caption under Reduce Motion, like the web)
 *   caption enter    : keyed per caption → `summary-caption-in 320ms ease`
 *                      (opacity 0→1, translateY 3→0); the outgoing caption
 *                      disappears instantly (no exit, as on the web).
 *                      Reduce Motion → no animation.
 *   shimmer bars     : `summary-shimmer 1.6s ease-in-out infinite` —
 *                      linear-gradient(90deg, accent 6% → 22% → 6%) at
 *                      background-size 180%, background-position 180% → -180%
 *                      (repeating). Native: a row of three 1.8·W gradient
 *                      tiles translated from −1.44·W to +1.44·W (the exact
 *                      CSS math), one shared clock for all five bars.
 *                      Reduce Motion → static gradient at position 0.
 *   card mount       : instant (the web swaps idle → loading → ready with no
 *                      crossfade).
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View, type DimensionValue } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView } from "expo-symbols";
import { C } from "~/lib/theme";
import { EASE, twEnter, useReduceMotion } from "~/lib/motion";
import { useT } from "~/i18n";

const CAPTION_KEYS = ["session.captionReading", "session.captionFinding", "session.captionWriting"] as const;
const ROTATE_MS = 2200;
const SHIMMER_MS = 1600;
/** background-size 180% → tile width = 1.8 × bar width. */
const TILE = 1.8;
/** CSS: position p% offsets the image by (W − 1.8W)·p → 180% ↔ −1.44W, −180% ↔ +1.44W. */
const FROM = -1.44;
const TO = 1.44;

/** summary-caption-in: 320ms CSS ease, opacity 0→1 + translateY 3→0; off under reduce. */
const captionIn = twEnter({ opacity: 0, translateY: 3, duration: 320, easing: EASE.css, reduce: "system" });

const BARS: { width: DimensionValue; height: number }[] = [
  { width: "38%", height: 12 },
  { width: "92%", height: 10 },
  { width: "80%", height: 10 },
  { width: "88%", height: 10 },
  { width: "58%", height: 10 },
];

const ACCENT_6 = "rgba(46, 204, 113, 0.06)";
const ACCENT_22 = "rgba(46, 204, 113, 0.22)";

export function SummaryLoading() {
  const t = useT();
  const reduce = useReduceMotion();
  const [i, setI] = useState(0);
  // One clock for all five bars (the CSS bars all start on the same frame).
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduce) return; // hold on the first caption, no rotation
    const id = setInterval(() => setI((n) => (n + 1) % CAPTION_KEYS.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [reduce]);

  useEffect(() => {
    if (reduce) {
      cancelAnimation(clock);
      clock.value = -1; // sentinel: static, position 0%
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(1, { duration: SHIMMER_MS, easing: EASE.cssInOut, reduceMotion: ReduceMotion.Never }),
      -1,
      false
    );
    return () => cancelAnimation(clock);
  }, [reduce, clock]);

  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
      <View style={styles.headerRow}>
        <SymbolView name="sparkle" tintColor={C.accent} size={14} />
        <Text style={styles.label}>{t("session.summarizing")}</Text>
      </View>

      {/* Rotating caption — keyed so it re-plays the fade-up on each change. */}
      <View style={styles.captionBox}>
        <Animated.Text key={i} entering={captionIn} style={styles.caption}>
          {t(CAPTION_KEYS[i])}
        </Animated.Text>
      </View>

      <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {BARS.map((b, idx) => (
          <ShimmerBar key={idx} width={b.width} height={b.height} clock={clock} />
        ))}
      </View>
    </View>
  );
}

function ShimmerBar({
  width,
  height,
  clock,
}: {
  width: DimensionValue;
  height: number;
  clock: SharedValue<number>;
}) {
  const [w, setW] = useState(0);
  const tileW = w * TILE;

  const slide = useAnimatedStyle(() => {
    // Offset of the repeating image relative to the bar's left edge.
    const offset = clock.value < 0 ? 0 : (FROM + (TO - FROM) * clock.value) * w;
    // Three adjacent tiles starting one tile to the left always cover [0, W].
    return { transform: [{ translateX: offset - tileW }] };
  });

  return (
    <View
      // Web .summary-shimmer-bar has NO background-color — only the gradient.
      // The tiles always cover the whole bar once measured, so a base fill
      // would composite the 6% accent twice (trough ≈11.6%, peak ≈26.7%).
      // Keep the flat 6% only for the pre-layout frame, before tiles mount.
      style={[styles.bar, { width, height }, w === 0 && styles.barPreLayout]}
      onLayout={(e) => {
        const next = e.nativeEvent.layout.width;
        if (Math.abs(next - w) > 0.5) setW(next);
      }}
    >
      {w > 0 ? (
        <Animated.View style={[styles.tiles, { width: tileW * 3 }, slide]}>
          {[0, 1, 2].map((k) => (
            <LinearGradient
              key={k}
              colors={[ACCENT_6, ACCENT_22, ACCENT_6]}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ width: tileW, height: "100%" }}
            />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: "rgba(46, 204, 113, 0.19)", // accent + "30"
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  label: {
    color: C.accent,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.55,
  },
  captionBox: { marginBottom: 16, minHeight: 20 },
  caption: { color: C.t2, fontSize: 14, lineHeight: 20 },
  bars: { gap: 10 },
  bar: { borderRadius: 6, overflow: "hidden" },
  barPreLayout: { backgroundColor: ACCENT_6 },
  tiles: { flexDirection: "row", height: "100%" },
});
