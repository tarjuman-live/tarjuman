/**
 * Paired transcript — native port of src/components/recording/live-transcript.tsx
 * (+ animate-in.tsx, + the session-body scroller behaviour).
 *
 * The transcript IS the product: large type, a speaker-tinted source card
 * (correct RTL direction) above its green-edged translation.
 *
 * Motion (all lifted from the web):
 *   - NEW live rows: AnimateIn "source" AS THE WEB RENDERS IT (opacity 0→1,
 *     scale .985→1, 620ms easeOutCubic, NO rise) — `liveSourceRowEntering`.
 *   - Translation card: AnimateIn "translation" (opacity only, 520ms) plays
 *     on the FIRST streamed partial (the card mounts when text first appears),
 *     then the text grows in place. The "…translating" placeholder has no
 *     enter/exit (web swaps it instantly; it is static — no pulse/shimmer).
 *   - NO layout/exit animation on rows (house rule: no auto-animate on
 *     transcript scrollers). Filter/merge removals are instant, like the web.
 *   - Main-speaker filter (web `mainSpeakerOnly`): render-time; rows the
 *     filter re-admits mount fresh and replay their entrance, removals are
 *     instant (useVisibleRows).
 *   - Interim partial: static, faded (opacity .5), mutates in place.
 *   - Auto-scroll: ONE continuous eased follow (hooks/use-sticky-bottom).
 *   - "↓ N new" pill when scrolled up: press scale .95 (150ms tw). Web mounts
 *     it instantly; native fades it in/out (150ms) per the fluid rule.
 *   - Retry card: press scale .99 (150ms tw).
 *   Entrances are live-only (`follow`); a static caller (`follow` omitted)
 *   renders rows without entrances. (app/session/[id] does NOT use this
 *   component — it scrolls with its own body; its sticky glide should come
 *   from useStaticStickyBottom in hooks/use-sticky-bottom.)
 *   Reduce Motion: rows appear instantly (web finalize()), the follow jumps.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { PressableScale } from "~/components/motion";
import { useStickyBottom, STICKY } from "~/hooks/use-sticky-bottom";
import { rtlRow, useLocale, useT } from "~/i18n";
import { isRtl } from "~/lib/lang";
import { EASE, twEnter, TW_ENTER, TW_EXIT } from "~/lib/motion";
import { C } from "~/lib/theme";

/**
 * Row entrances matched to what the web ACTUALLY renders, not to what
 * animate-in.tsx's source text reads as. The web calls motion/mini's
 * `animate(el, { opacity, y, scale })`; motion/mini is WAAPI-only and passes
 * each key straight to `element.animate({ y: [...] })` (framer-motion
 * animate-elements.mjs -> motion-dom start-waapi-animation.mjs, no transform
 * mapping). `y` is the SVG geometry property and is inert on an HTML div, so
 * the web shows NO rise:
 *   source      = opacity 0→1 + CSS `scale` .985→1, 620ms bezier(.33,1,.68,1)
 *   translation = opacity 0→1 only,                 520ms bezier(.33,1,.68,1)
 * The shared `sourceRowEntering` / `translationRowEntering` in lib/motion add
 * translateY 14/10 (the web's intent), which would put a slide on every new
 * native row that web users never see — so the transcript uses these instead.
 * Reduce Motion: shown instantly (web `finalize()` path).
 */
export const liveSourceRowEntering = twEnter({
  opacity: 0,
  scale: 0.985,
  duration: 620,
  easing: EASE.outCubic,
  reduce: "system",
});

export const liveTranslationRowEntering = twEnter({
  opacity: 0,
  duration: 520,
  easing: EASE.outCubic,
  reduce: "system",
});

export interface TranscriptRow {
  id: string;
  sourceText: string;
  /** undefined = still translating; "" = fail-open blank translation. */
  translatedText?: string;
  error?: string;
  /**
   * Optional: translation in flight. Lets the "…translating" placeholder show
   * while the streamed text is "" (meta-guard held it back) — web `pending`.
   * Omitted → "still translating" is inferred from `translatedText === undefined`.
   */
  pending?: boolean;
  /** Optional diarization speaker (0-based) → per-speaker tint + badge. */
  speaker?: number;
  /** Engine-reported segment duration (s) — weights the dominant speaker. */
  durationSec?: number;
}

/** What the speaker logic reads (a LiveSegment satisfies it). */
export interface SpeakerSample {
  speaker?: number;
  durationSec?: number;
}

/** Shared by <Transcript> and <SplitTranscript> (components/split-transcript.tsx). */
export interface TranscriptProps {
  rows: TranscriptRow[];
  sourceLanguage: string;
  targetLanguage: string;
  /** Live partial, rendered faded under the last card. */
  interimText?: string;
  /** Live view: glide to the newest segment as it lands + animate new rows. */
  follow?: boolean;
  header?: ReactNode;
  empty?: ReactNode;
  onRetry?: (id: string) => void;
  /**
   * Web `mainSpeakerOnly`: hide rows whose speaker isn't the dominant one
   * (render-time, reversible — toggling OFF re-mounts the hidden rows, which
   * replay their entrance; ON removes them instantly; a dominant-speaker flip
   * swaps them). Rows with no speaker always show.
   */
  mainSpeakerOnly?: boolean;
  /**
   * The FULL engine segment list (e.g. `stt.segments`), before the
   * filtered/suppressed/merge removals. The web computes the dominant speaker
   * and the speaker badges over every segment, not just the visible ones.
   * Omitted → derived from `rows`.
   */
  speakerSegments?: readonly SpeakerSample[];
}

// ─── Shared helpers (also used by split-transcript.tsx) ─────────────────────

const SPEAKER_COLORS = ["#3B82F6", "#A855F7", "#F59E0B", "#EF4444", "#10B981", "#EC4899"];

export function speakerColor(s: number | undefined): string {
  if (s === undefined) return SPEAKER_COLORS[0];
  return SPEAKER_COLORS[s % SPEAKER_COLORS.length];
}

/** `#RRGGBB` + a CSS hex-alpha byte (e.g. 0x14) → rgba() (web `${hex}14`). */
export function withAlpha(hex: string, alphaByte: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const a = Math.round((alphaByte / 255) * 1000) / 1000;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Web fontSizeForLang: RTL scripts 22, CJK 20, else 19. */
export function fontSizeForLang(lang: string): number {
  if (isRtl(lang)) return 22;
  if (lang === "zh" || lang === "ja" || lang === "ko") return 20;
  return 19;
}

/** More than one diarized speaker → badges + per-speaker tint (web showSpeakerBadges). */
export function hasMultipleSpeakers(rows: readonly SpeakerSample[]): boolean {
  let first: number | undefined;
  for (const r of rows) {
    if (typeof r.speaker !== "number") continue;
    if (first === undefined) first = r.speaker;
    else if (r.speaker !== first) return true;
  }
  return false;
}

/**
 * Web live-transcript.tsx dominantSpeaker: the speaker with the most
 * cumulative `durationSec` (1 per segment when unreported); first wins ties.
 */
export function dominantSpeaker(segments: readonly SpeakerSample[]): number | undefined {
  const totals = new Map<number, number>();
  for (const s of segments) {
    if (typeof s.speaker !== "number") continue;
    totals.set(s.speaker, (totals.get(s.speaker) ?? 0) + (s.durationSec ?? 1));
  }
  let maxDur = -1;
  let dominant: number | undefined;
  for (const [sp, d] of totals) {
    if (d > maxDur) {
      maxDur = d;
      dominant = sp;
    }
  }
  return dominant;
}

/**
 * Web visibility rules shared by both layouts: the optional main-speaker
 * filter over the (already filtered/merged) rows, plus the badge decision
 * over every segment. Rows stay keyed by id, so a row the filter re-admits
 * mounts fresh and replays its entrance — exactly like the web.
 */
export function useVisibleRows(
  rows: TranscriptRow[],
  mainSpeakerOnly: boolean | undefined,
  speakerSegments: readonly SpeakerSample[] | undefined
): { visible: TranscriptRow[]; showSpeakerBadges: boolean } {
  return useMemo(() => {
    const all = speakerSegments ?? rows;
    const showSpeakerBadges = hasMultipleSpeakers(all);
    if (!mainSpeakerOnly) return { visible: rows, showSpeakerBadges };
    const dominant = dominantSpeaker(all);
    return {
      visible: rows.filter((r) => r.speaker === undefined || r.speaker === dominant),
      showSpeakerBadges,
    };
  }, [rows, mainSpeakerOnly, speakerSegments]);
}

// RTL is not optional: Arabic/Urdu source must read right-to-left.
export const align = (rtl: boolean) =>
  rtl ? ({ writingDirection: "rtl", textAlign: "right" } as const) : ({ writingDirection: "ltr", textAlign: "left" } as const);

/** Web `borderInlineStart: 3px solid color` for a given text direction. */
const startBorder = (rtl: boolean, color: string) =>
  rtl ? { borderRightWidth: 3, borderRightColor: color } : { borderLeftWidth: 3, borderLeftColor: color };

/**
 * "Translating" placeholder ↔ translated card ↔ error, per the web's order:
 * text present → card; in flight → placeholder; failed → retry; else nothing.
 */
export function translationState(
  translated: string | undefined,
  pending: boolean | undefined,
  error: string | undefined
): "text" | "pending" | "error" | "none" {
  if (translated && translated.length > 0) return "text";
  if (pending ?? (translated === undefined && !error)) return "pending";
  if (error) return "error";
  return "none";
}

// ─── "↓ N new" / "latest ↓" pill ────────────────────────────────────────────

/**
 * Accent pill (web: bottom-4 h-9 px-4 12px bold / split: bottom-3 h-8 px-3
 * 11px). Press: `transition-transform active:scale-95` → .95, 150ms tw.
 * Web mounts/unmounts it instantly; native adds a 150ms fade in AND out
 * (house fluid rule — flagged enhancement).
 */
export function JumpPill({
  label,
  a11yLabel,
  onPress,
  compact = false,
}: {
  label: string;
  a11yLabel: string;
  onPress: () => void;
  compact?: boolean;
}) {
  const { dir } = useLocale();
  return (
    <Animated.View
      pointerEvents="box-none"
      entering={TW_ENTER.fade}
      exiting={TW_EXIT.fade}
      style={[styles.pillWrap, { bottom: compact ? 12 : 16 }]}
    >
      <PressableScale
        onPress={onPress}
        scaleTo={0.95}
        duration={150}
        easing={EASE.tw}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        hitSlop={8}
        style={[styles.pill, compact && styles.pillCompact, rtlRow(dir)]}
      >
        <Text style={[styles.pillText, compact && styles.pillTextCompact]}>{label}</Text>
        <SymbolView name="chevron.down" size={compact ? 11 : 12} weight="bold" tintColor="#0A0F1C" />
      </PressableScale>
    </Animated.View>
  );
}

// ─── One paired row ─────────────────────────────────────────────────────────

interface PairedRowProps {
  id: string;
  sourceText: string;
  translated: string | undefined;
  pending: boolean | undefined;
  error: string | undefined;
  speaker: number | undefined;
  showSpeakerBadges: boolean;
  srcRtl: boolean;
  tgtRtl: boolean;
  srcSize: number;
  tgtSize: number;
  animate: boolean;
  onRetry?: (id: string) => void;
}

/**
 * Memoised on primitives: the parent re-renders several times a second
 * (interim text), and a long lecture has 200+ rows (web PairedSegmentRow).
 */
const PairedRow = memo(function PairedRow({
  id,
  sourceText,
  translated,
  pending,
  error,
  speaker,
  showSpeakerBadges,
  srcRtl,
  tgtRtl,
  srcSize,
  tgtSize,
  animate,
  onRetry,
}: PairedRowProps) {
  const t = useT();
  const sc = speakerColor(speaker);
  const state = translationState(translated, pending, error);
  return (
    <View style={styles.pair}>
      <Animated.View
        entering={animate ? liveSourceRowEntering : undefined}
        style={[styles.card, styles.sourceCard, { backgroundColor: withAlpha(sc, 0x14) }, startBorder(srcRtl, withAlpha(sc, 0x66))]}
      >
        {showSpeakerBadges && typeof speaker === "number" ? (
          <Text style={[styles.badge, { color: sc }, align(srcRtl)]}>
            {t("transcript.speaker", { n: speaker + 1 })}
          </Text>
        ) : null}
        <Text
          style={[
            styles.sourceText,
            { fontSize: srcSize, lineHeight: srcSize * 1.7, fontWeight: srcRtl ? "500" : "400" },
            align(srcRtl),
          ]}
        >
          {sourceText}
        </Text>
      </Animated.View>

      {state === "text" ? (
        <Animated.View
          key="t"
          entering={animate ? liveTranslationRowEntering : undefined}
          style={[styles.card, styles.translationCard, startBorder(tgtRtl, withAlpha(C.accent, 0x66))]}
        >
          <Text
            style={[
              styles.translatedText,
              { fontSize: tgtSize, lineHeight: tgtSize * 1.7, fontWeight: tgtRtl ? "600" : "500" },
              align(tgtRtl),
            ]}
          >
            {renderTextWithLinks(translated ?? "")}
          </Text>
        </Animated.View>
      ) : state === "pending" ? (
        <View key="p" style={[styles.card, styles.translationCard, startBorder(false, withAlpha(C.accent, 0x66))]}>
          <Text style={styles.pending}>{t("transcript.translating")}</Text>
        </View>
      ) : state === "error" ? (
        onRetry ? (
          <PressableScale
            key="e"
            onPress={() => onRetry(id)}
            scaleTo={0.99}
            duration={150}
            easing={EASE.tw}
            accessibilityRole="button"
            style={[styles.card, styles.errorCard]}
          >
            <Text style={styles.errorTitle}>{t("transcript.failedRetry")}</Text>
            <Text style={styles.errorDetail}>{error}</Text>
          </PressableScale>
        ) : (
          <View key="e" style={[styles.card, styles.errorCard]}>
            <Text style={styles.errorTitle}>{t("transcript.failed")}</Text>
            <Text style={styles.errorDetail}>{error}</Text>
          </View>
        )
      ) : null /* fail-open: source-only */}
    </View>
  );
});

// ─── Transcript ─────────────────────────────────────────────────────────────

/**
 * Scrollable paired transcript. Live (`follow`): pinned to the newest line
 * with a 200px lookahead; scrolling up disengages and a "↓ N new" pill
 * appears once new lines land — tap glides back and re-pins. Static (no
 * `follow`): opens at the TOP and only re-pins if the user scrolls to within
 * 200px of the bottom (web session-body `startStuck: false`).
 */
export function Transcript({
  rows,
  sourceLanguage,
  targetLanguage,
  interimText,
  follow,
  header,
  empty,
  onRetry,
  mainSpeakerOnly,
  speakerSegments,
}: TranscriptProps) {
  const t = useT();
  const { visible, showSpeakerBadges } = useVisibleRows(rows, mainSpeakerOnly, speakerSegments);
  const { scrollRef, isStuck, scrollToBottom, scrollProps } = useStickyBottom(STICKY.threshold, {
    startStuck: !!follow,
  });
  const srcRtl = isRtl(sourceLanguage);
  const tgtRtl = isRtl(targetLanguage);
  const srcSize = fontSizeForLang(sourceLanguage);
  const tgtSize = fontSizeForLang(targetLanguage);

  // Unread: VISIBLE rows that landed while scrolled up (web LiveTranscript).
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef(0);
  useEffect(() => {
    if (isStuck) {
      lastSeenRef.current = visible.length;
      setUnread(0);
      return;
    }
    if (visible.length > lastSeenRef.current) setUnread(visible.length - lastSeenRef.current);
  }, [visible.length, isStuck]);

  const showEmpty = visible.length === 0 && !interimText;

  return (
    <View style={styles.fill}>
      <Animated.ScrollView
        ref={scrollRef}
        {...scrollProps}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {header}
        {showEmpty ? (empty ?? <DefaultEmpty />) : null}
        {visible.map((r) => (
          <PairedRow
            key={r.id}
            id={r.id}
            sourceText={r.sourceText}
            translated={r.translatedText}
            pending={r.pending}
            error={r.error}
            speaker={r.speaker}
            showSpeakerBadges={showSpeakerBadges}
            srcRtl={srcRtl}
            tgtRtl={tgtRtl}
            srcSize={srcSize}
            tgtSize={tgtSize}
            animate={!!follow}
            onRetry={onRetry}
          />
        ))}
        {interimText ? (
          // Static + faded; text mutates in place (never animate interim).
          <View style={[styles.card, styles.interim, startBorder(srcRtl, withAlpha(C.blue, 0x33))]}>
            <Text
              style={[
                styles.interimText,
                { fontSize: srcSize, lineHeight: srcSize * 1.7, fontWeight: srcRtl ? "500" : "400" },
                align(srcRtl),
              ]}
            >
              {interimText}
            </Text>
          </View>
        ) : null}
      </Animated.ScrollView>

      {follow && !isStuck && unread > 0 ? (
        <JumpPill
          label={t("transcript.newCount", { n: unread })}
          a11yLabel={t(unread === 1 ? "transcript.scrollToNewOne" : "transcript.scrollToNew", { n: unread })}
          onPress={scrollToBottom}
        />
      ) : null}
    </View>
  );
}

/** Web paired empty state: centred t4 "Listening…" + hint (no motion). */
function DefaultEmpty() {
  const t = useT();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{t("record.listening")}</Text>
      <Text style={styles.emptyHint}>{t("transcript.speakNearDevice")}</Text>
    </View>
  );
}

// ─── Citation links (lib/citation-renderer.tsx) ─────────────────────────────

const CITATION_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

const openCitation = (url: string) => {
  void WebBrowser.openBrowserAsync(url).catch(() => {});
};

/**
 * Port of the web's renderTextWithLinks: the /api/translate trailer appends
 * `[label](https://sunnah.com|quran.com/…)` citations; render them as accent,
 * underlined, tappable links (in-app browser) instead of literal markdown.
 * Only this narrow pattern is parsed, so stray `*`/`_`/`#` stay plain text.
 */
export function renderTextWithLinks(text: string): ReactNode {
  if (!text || !text.includes("[")) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  CITATION_LINK_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = CITATION_LINK_RE.exec(text)); ) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const url = m[2];
    out.push(
      <Text
        key={`${m.index}-${url}`}
        style={styles.citationLink}
        onPress={() => openCitation(url)}
        accessibilityRole="link"
      >
        {m[1]}
      </Text>
    );
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 20 },
  pair: {},
  // rounded-2xl px-4 py-3
  card: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  sourceCard: { marginBottom: 6 },
  badge: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sourceText: { color: C.t2 },
  translationCard: { backgroundColor: withAlpha(C.accent, 0x10) },
  translatedText: { color: C.w },
  citationLink: { color: C.accent, textDecorationLine: "underline" },
  pending: { color: C.t3, fontSize: 14 },
  errorCard: {
    backgroundColor: withAlpha(C.amber, 0x14),
    // Web uses a physical borderLeft here (not inline-start).
    borderLeftWidth: 3,
    borderLeftColor: withAlpha(C.amber, 0x66),
  },
  errorTitle: { color: C.amber, fontSize: 13, fontWeight: "600" },
  errorDetail: { color: C.t3, fontSize: 11, marginTop: 4 },
  interim: { backgroundColor: withAlpha(C.blue, 0x0d), opacity: 0.5 },
  interimText: { color: C.t3 },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyTitle: { color: C.t4, fontSize: 14 },
  emptyHint: { color: C.t4, fontSize: 12, marginTop: 4, textAlign: "center" },
  pillWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 10 },
  pill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    gap: 8,
    backgroundColor: C.accent,
    boxShadow: "0 6px 24px rgba(46, 204, 113, 0.25), 0 0 0 1px #2ECC71",
  },
  pillCompact: { height: 32, paddingHorizontal: 12, gap: 4 },
  pillText: { color: "#0A0F1C", fontSize: 12, fontWeight: "700" },
  pillTextCompact: { fontSize: 11 },
});
