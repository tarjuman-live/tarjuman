/**
 * Split ("half and half") transcript — native port of
 * src/components/recording/split-transcript.tsx. Same live data and props as
 * <Transcript> (drop-in: the record screen can swap layouts with no other
 * change), but each language gets its own independently scrolling pane.
 *
 * Liquid glass: each half is a floating frosted panel (`.glass-panel` →
 * GlassBackground) over a faint, STATIC ambient wash; every line is a glass
 * tile; the language label is a small blurred chip the tiles slide under and
 * refract through (the one "liquid" moment — live BlurView over the scroller).
 *
 * Stacks source (top) / target (bottom) on a phone; side by side ≥ 768pt
 * (web `md:`). Each pane runs its own sticky-bottom glide and shows its own
 * "latest ↓" pill whenever it is scrolled off the bottom.
 *
 * Motion (web parity):
 *   - Source tile: AnimateIn "source" entrance (as the web renders it: opacity
 *     + scale .985→1, no rise — see liveSourceRowEntering) on the tile's wrapper (the tile
 *     itself carries the press lift, like the web keeps :hover off AnimateIn).
 *   - Target tile: AnimateIn "translation" on the first streamed partial.
 *   - `.glass-tile` hover (lift −1px 220ms bezier(.3,.9,.4,1); rim → accent 45%
 *     + green glow 220ms ease) → while pressed. Under Reduce Motion: no lift,
 *     border/glow snap (web `transition: none`).
 *   - Speaker tint crossfade: when diarization first splits the room, source
 *     tiles fade neutral → speaker tint (bg + rim, 220ms ease; snaps on reduce).
 *   - Retry tile: scale .99 while pressed (web snaps it — Tailwind v4 `scale`
 *     isn't in .glass-tile's transition list; native eases it on the tile's
 *     220ms lift curve per the fluid rule).
 *   - Interim tile static at opacity .6; empty tiles mount/unmount instantly.
 *   - No layout/exit animation on rows (no auto-animate on transcripts).
 */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { GLASS, GlassBackground } from "~/components/glass";
import { useStickyBottom, STICKY } from "~/hooks/use-sticky-bottom";
import { useT } from "~/i18n";
import { isRtl, langName } from "~/lib/lang";
import {
  cssEase,
  REDUCE_MOTION,
} from "~/lib/motion";
import { C } from "~/lib/theme";
import {
  align,
  fontSizeForLang,
  JumpPill,
  liveSourceRowEntering,
  liveTranslationRowEntering,
  renderTextWithLinks,
  speakerColor,
  translationState,
  useVisibleRows,
  withAlpha,
  type TranscriptProps,
} from "./transcript";

// ─── Glass tile (.glass-tile) ───────────────────────────────────────────────

/** .glass-tile transform curve. */
const TILE_LIFT_EASE = Easing.bezier(0.3, 0.9, 0.4, 1);
const TILE_MS = 220;
/** `color-mix(in srgb, accent 45%, transparent)`. */
const LIT_RIM = "rgba(46, 204, 113, 0.45)";
const BASE_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.22), 0 2px 10px rgba(0, 0, 0, 0.22)";
const LIT_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -1px 1px rgba(0, 0, 0, 0.22), 0 10px 30px rgba(46, 204, 113, 0.16)";
const TILE_RADIUS = 18;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface GlassTileProps {
  /** --tile-tint (background). Changes crossfade 220ms ease. */
  tint: string;
  /** --tile-rim (border). Changes crossfade 220ms ease. */
  rim: string;
  onPress?: () => void;
  /** Scale while pressed (retry tile: .99). */
  pressScale?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * One glass line. Press = the web's hover (lift + green outline-glow). A short
 * press delay (iOS's own scroll-view touch delay) keeps a scroll swipe from
 * flashing the glow on whatever tile the finger landed on.
 */
function GlassTile({ tint, rim, onPress, pressScale = 1, accessibilityLabel, style, children }: GlassTileProps) {
  const press = useSharedValue(0);
  const glow = useSharedValue(0);
  // The lit shadow layer is only mounted once a tile has been touched — a
  // 200-row lecture shouldn't carry 200 idle glow layers.
  const [everLit, setEverLit] = useState(false);

  // Tint crossfade (speaker tint arriving): from previous → new colours.
  const fromTint = useSharedValue(tint);
  const toTint = useSharedValue(tint);
  const fromRim = useSharedValue(rim);
  const toRim = useSharedValue(rim);
  const mix = useSharedValue(1);
  const prev = useRef({ tint, rim });
  useEffect(() => {
    if (prev.current.tint === tint && prev.current.rim === rim) return;
    fromTint.value = prev.current.tint;
    fromRim.value = prev.current.rim;
    toTint.value = tint;
    toRim.value = rim;
    prev.current = { tint, rim };
    if (REDUCE_MOTION.value) {
      mix.value = 1;
      return;
    }
    mix.value = 0;
    mix.value = withTiming(1, cssEase(TILE_MS, ReduceMotion.Never));
  }, [tint, rim, fromTint, fromRim, toTint, toRim, mix]);

  const setLit = (on: boolean) => {
    if (on && !everLit) setEverLit(true);
    const to = on ? 1 : 0;
    if (REDUCE_MOTION.value) {
      press.value = to;
      glow.value = to;
      return;
    }
    press.value = withTiming(to, { duration: TILE_MS, easing: TILE_LIFT_EASE, reduceMotion: ReduceMotion.Never });
    glow.value = withTiming(to, cssEase(TILE_MS, ReduceMotion.Never));
  };

  const tileStyle = useAnimatedStyle(() => {
    const rimNow = interpolateColor(mix.value, [0, 1], [fromRim.value, toRim.value]);
    return {
      backgroundColor: interpolateColor(mix.value, [0, 1], [fromTint.value, toTint.value]),
      borderColor: interpolateColor(glow.value, [0, 1], [rimNow, LIT_RIM]),
      transform: [
        { translateY: REDUCE_MOTION.value ? 0 : -press.value },
        { scale: 1 + (pressScale - 1) * press.value },
      ],
    };
  });
  const baseLayer = useAnimatedStyle(() => ({ opacity: 1 - glow.value }));
  const litLayer = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => setLit(true)}
      onPressOut={() => setLit(false)}
      unstable_pressDelay={onPress ? 60 : 100}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.tile, style, tileStyle]}
    >
      <Animated.View pointerEvents="none" style={[styles.shadowLayer, { boxShadow: BASE_SHADOW }, baseLayer]} />
      {everLit ? (
        <Animated.View pointerEvents="none" style={[styles.shadowLayer, { boxShadow: LIT_SHADOW }, litLayer]} />
      ) : null}
      {children}
    </AnimatedPressable>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────

const NEUTRAL_TINT = "rgba(255, 255, 255, 0.05)";
const NEUTRAL_RIM = "rgba(255, 255, 255, 0.09)";

const SplitSourceRow = memo(function SplitSourceRow({
  text,
  speaker,
  showSpeakerBadges,
  srcRtl,
  srcSize,
  animate,
}: {
  text: string;
  speaker: number | undefined;
  showSpeakerBadges: boolean;
  srcRtl: boolean;
  srcSize: number;
  animate: boolean;
}) {
  const t = useT();
  const sc = speakerColor(speaker);
  // One speaker → neutral smoked glass; once diarization splits the room each
  // speaker tints their own glass (crossfades via GlassTile).
  const tinted = showSpeakerBadges && typeof speaker === "number";
  return (
    <Animated.View entering={animate ? liveSourceRowEntering : undefined} style={styles.rowGap}>
      <GlassTile
        tint={tinted ? withAlpha(sc, 0x14) : NEUTRAL_TINT}
        rim={tinted ? withAlpha(sc, 0x40) : NEUTRAL_RIM}
      >
        {tinted ? (
          <Text style={[styles.badge, { color: sc }, align(srcRtl)]}>
            {t("transcript.speaker", { n: (speaker as number) + 1 })}
          </Text>
        ) : null}
        <Text
          style={[
            styles.sourceText,
            { fontSize: srcSize, lineHeight: srcSize * 1.7, fontWeight: srcRtl ? "500" : "400" },
            align(srcRtl),
          ]}
        >
          {text}
        </Text>
      </GlassTile>
    </Animated.View>
  );
});

const SplitTargetRow = memo(function SplitTargetRow({
  id,
  translated,
  pending,
  error,
  tgtRtl,
  tgtSize,
  animate,
  onRetry,
}: {
  id: string;
  translated: string | undefined;
  pending: boolean | undefined;
  error: string | undefined;
  tgtRtl: boolean;
  tgtSize: number;
  animate: boolean;
  onRetry?: (id: string) => void;
}) {
  const t = useT();
  const state = translationState(translated, pending, error);

  if (state === "text") {
    return (
      <Animated.View key="t" entering={animate ? liveTranslationRowEntering : undefined} style={styles.rowGap}>
        <GlassTile tint="rgba(46, 204, 113, 0.07)" rim="rgba(46, 204, 113, 0.20)">
          <Text
            style={[
              styles.translatedText,
              { fontSize: tgtSize, lineHeight: tgtSize * 1.7, fontWeight: tgtRtl ? "600" : "500" },
              align(tgtRtl),
            ]}
          >
            {renderTextWithLinks(translated ?? "")}
          </Text>
        </GlassTile>
      </Animated.View>
    );
  }
  if (state === "pending") {
    return (
      <GlassTile key="p" tint="rgba(46, 204, 113, 0.04)" rim="rgba(46, 204, 113, 0.12)" style={styles.rowGap}>
        <Text style={[styles.pending, align(tgtRtl)]}>{t("transcript.translating")}</Text>
      </GlassTile>
    );
  }
  if (state === "error") {
    return (
      <GlassTile
        key="e"
        tint="rgba(245, 158, 11, 0.09)"
        rim="rgba(245, 158, 11, 0.28)"
        onPress={onRetry ? () => onRetry(id) : undefined}
        pressScale={onRetry ? 0.99 : 1}
        accessibilityLabel={t(onRetry ? "transcript.failedRetry" : "transcript.failed")}
        style={styles.rowGap}
      >
        <Text style={[styles.errorTitle, align(tgtRtl)]}>
          {t(onRetry ? "transcript.failedRetry" : "transcript.failed")}
        </Text>
      </GlassTile>
    );
  }
  // Fail-open: source-only — render nothing rather than an empty tile.
  return null;
});

/** Empty-state copy in the same glass material (no motion). */
function EmptyTile({ children }: { children: ReactNode }) {
  return (
    <View style={styles.emptyWrap}>
      <GlassTile tint="rgba(255, 255, 255, 0.04)" rim="rgba(255, 255, 255, 0.07)" style={styles.emptyTile}>
        {children}
      </GlassTile>
    </View>
  );
}

/**
 * Language label — a blurred glass chip floating over the scroller (absolute),
 * so tiles pass UNDER it and blur through it. Web `.glass-chip`: rgba(20,28,46,
 * .55) + blur(18px) saturate(160%) (no native saturate), 1px border-light, the
 * glass inset highlights, radius 10.
 */
function PaneLabel({ name, color }: { name: string; color: string }) {
  return (
    <View pointerEvents="none" style={styles.labelRow}>
      <View style={styles.chipOuter}>
        <View style={styles.chipInner}>
          <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(20, 28, 46, 0.55)" }]} />
          <Text style={[styles.chipText, { color }]}>{name}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── SplitTranscript ────────────────────────────────────────────────────────

/**
 * `follow` defaults to true here: the web split view only exists live. Pass
 * `follow={false}` for a static (saved) split, which opens at the top and
 * skips row entrances.
 *
 * `empty` is deliberately IGNORED: it is the paired view's empty node (its
 * own padding + paired copy). The web split always shows its own compact
 * "Listening… / Speak or play audio nearby." tile, matching the target pane's.
 */
export function SplitTranscript({
  rows,
  sourceLanguage,
  targetLanguage,
  interimText,
  follow,
  header,
  onRetry,
  mainSpeakerOnly,
  speakerSegments,
}: TranscriptProps) {
  const t = useT();
  const live = follow ?? true;
  const { visible, showSpeakerBadges } = useVisibleRows(rows, mainSpeakerOnly, speakerSegments);
  const src = useStickyBottom(STICKY.threshold, { startStuck: live });
  const tgt = useStickyBottom(STICKY.threshold, { startStuck: live });
  const { width } = useWindowDimensions();
  const wide = width >= 768;

  const srcRtl = isRtl(sourceLanguage);
  const tgtRtl = isRtl(targetLanguage);
  const srcSize = fontSizeForLang(sourceLanguage);
  const tgtSize = fontSizeForLang(targetLanguage);
  const showEmpty = visible.length === 0 && !interimText;

  return (
    <View style={styles.fill}>
      {header}
      <View style={[styles.split, { flexDirection: wide ? "row" : "column" }]}>
        {/* Ambient wash — static and very faint: depth, not a light show. */}
        <View pointerEvents="none" style={styles.wash} />

        {/* ── SOURCE half ── */}
        <View style={styles.panel}>
          <GlassBackground radius={24} />
          <View style={styles.panelClip}>
            <Animated.ScrollView
              ref={src.scrollRef}
              {...src.scrollProps}
              contentContainerStyle={styles.paneContent}
            >
              {showEmpty ? (
                <EmptyTile>
                  <Text style={styles.emptyTitle}>{t("record.listening")}</Text>
                  <Text style={styles.emptyHint}>{t("record.speakNearby")}</Text>
                </EmptyTile>
              ) : null}
              {visible.map((r) => (
                <SplitSourceRow
                  key={r.id}
                  text={r.sourceText}
                  speaker={r.speaker}
                  showSpeakerBadges={showSpeakerBadges}
                  srcRtl={srcRtl}
                  srcSize={srcSize}
                  animate={live}
                />
              ))}
              {interimText ? (
                <View style={styles.interimWrap}>
                  <GlassTile tint="rgba(59, 130, 246, 0.06)" rim="rgba(59, 130, 246, 0.16)">
                    <Text
                      style={[
                        styles.interimText,
                        { fontSize: srcSize, lineHeight: srcSize * 1.7, fontWeight: srcRtl ? "500" : "400" },
                        align(srcRtl),
                      ]}
                    >
                      {interimText}
                    </Text>
                  </GlassTile>
                </View>
              ) : null}
            </Animated.ScrollView>
            <PaneLabel name={langName(sourceLanguage)} color={C.t3} />
            {!src.isStuck ? (
              <JumpPill
                compact
                label={t("transcript.latest")}
                a11yLabel={t("transcript.scrollToLatest")}
                onPress={src.scrollToBottom}
              />
            ) : null}
          </View>
        </View>

        {/* ── TARGET half ── */}
        <View style={styles.panel}>
          <GlassBackground radius={24} />
          <View style={styles.panelClip}>
            <Animated.ScrollView
              ref={tgt.scrollRef}
              {...tgt.scrollProps}
              contentContainerStyle={styles.paneContent}
            >
              {showEmpty ? (
                <EmptyTile>
                  <Text style={[styles.emptyHint, { marginTop: 0 }]}>{t("record.translationHere")}</Text>
                </EmptyTile>
              ) : null}
              {visible.map((r) => (
                <SplitTargetRow
                  key={r.id}
                  id={r.id}
                  translated={r.translatedText}
                  pending={r.pending}
                  error={r.error}
                  tgtRtl={tgtRtl}
                  tgtSize={tgtSize}
                  animate={live}
                  onRetry={onRetry}
                />
              ))}
            </Animated.ScrollView>
            <PaneLabel name={langName(targetLanguage)} color={C.accent} />
            {!tgt.isStuck ? (
              <JumpPill
                compact
                label={t("transcript.latest")}
                a11yLabel={t("transcript.scrollToLatest")}
                onPress={tgt.scrollToBottom}
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // flex-1 min-h-0 flex-col md:flex-row gap-3 p-3
  split: { flex: 1, gap: 12, padding: 12 },
  wash: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage:
      "radial-gradient(45% 55% at 22% 18%, rgba(59,130,246,0.10), transparent 70%), " +
      "radial-gradient(45% 55% at 78% 82%, rgba(46,204,113,0.10), transparent 70%)",
  },
  // .glass-panel rounded-[24px]: border + drop shadow on the outer view.
  panel: { flex: 1, minHeight: 0, borderRadius: 24, ...GLASS.card },
  panelClip: { flex: 1, borderRadius: 24, overflow: "hidden" },
  // px-3 pt-[46px] pb-4 — the top padding keeps the first tile clear of the chip.
  paneContent: { paddingHorizontal: 12, paddingTop: 46, paddingBottom: 16 },
  rowGap: { marginBottom: 10 },
  // .glass-tile rounded-[18px] px-4 py-3
  tile: {
    borderRadius: TILE_RADIUS,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shadowLayer: { ...StyleSheet.absoluteFill, borderRadius: TILE_RADIUS - 1 },
  badge: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  sourceText: { color: C.t2 },
  translatedText: { color: C.w },
  pending: { color: C.t3, fontSize: 14 },
  errorTitle: { color: C.amber, fontSize: 13, fontWeight: "600" },
  interimWrap: { opacity: 0.6 },
  interimText: { color: C.t3 },
  emptyWrap: { alignItems: "center", paddingTop: 40 },
  emptyTile: { paddingHorizontal: 20, paddingVertical: 16, alignItems: "center" },
  emptyTitle: { color: C.t4, fontSize: 14, textAlign: "center" },
  emptyHint: { color: C.t4, fontSize: 12, marginTop: 4, textAlign: "center" },
  labelRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    flexDirection: "row",
    zIndex: 10,
  },
  chipOuter: { borderRadius: 10, boxShadow: "0 2px 10px rgba(0, 0, 0, 0.22)" },
  chipInner: {
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.22)",
  },
  chipText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
});
