/**
 * Session detail — port of src/app/(app)/session/[id]/page.tsx +
 * src/components/session/session-body.tsx, and (with `?completed=1`, pushed by
 * Record after Stop) the footer of src/components/session/completed-view.tsx.
 *
 * Motion (web → native):
 *   - route enter: template.tsx fade + 8px rise, 200ms CSS ease, once on mount
 *     (ScreenEnter; skipped under Reduce Motion) — on top of the native push.
 *   - loading: skeleton outline of the real layout (header bars, language bar,
 *     summary CTA block, 3 segment pairs), synced animate-pulse; content
 *     replaces it instantly (web: no crossfade).
 *   - summary: SummarySection (press scale, SummaryLoading, typewriter,
 *     citation swap) — see components/summary-view.tsx.
 *   - static sticky-bottom (useStickyBottom(200, { startStuck: false })):
 *     opens at the TOP; once the user scrolls within 200px of the bottom it
 *     re-engages and ONE continuous eased follow (22% of the remaining distance
 *     per 60Hz frame, 0.75px floor, 0.5px settle — run on the UI thread,
 *     frame-rate compensated for ProMotion) carries it to the very bottom and
 *     keeps it pinned while content grows. Scrolling up >200px releases it.
 *     Reduce Motion → jumps.
 *   - detail action bar: Copy / Share .md press scale .98 (150ms tw); the
 *     Copy colour + icon swap SNAP (web: transition-transform only), label
 *     "Copied" 1500ms / "Couldn't copy" (amber) 2000ms.
 *   - completed footer: Copy + New recording — press scale .98 and hover
 *     (border → accent, bg → surfaceLight) mapped to press, 200ms tw; Copy's
 *     label colour FADES (transition-all 200ms) while the icon snaps. Done —
 *     press scale .98, hover lift −2px + brightness(1.1) mapped to press.
 *   - delete: ConfirmDialog (overlay fade + card zoom-95, in and out) replaces
 *     Alert; the dialog finishes its exit before the screen pops.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import {
  useLocalSearchParams,
  useRouter,
  type ErrorBoundaryProps,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useMutation, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { api } from "@convex/api";
import type { Id } from "@convex/dataModel";
import { ErrorScreen } from "~/components/error-screen";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { ProAiTools } from "~/components/pro-ai-tools";
import { UpgradeCard } from "~/components/upgrade-card";
import {
  SummarySection,
  baseFontSize,
  renderLinks,
} from "~/components/summary-view";
import {
  PressableScale,
  ScreenEnter,
  SegmentSkeleton,
  Skeleton,
} from "~/components/motion";
import { formatDate, formatDuration, isRtl, langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { useT } from "~/i18n";
import { useStaticStickyBottom } from "~/hooks/use-sticky-bottom";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorScreen error={error} onRetry={retry} />;
}

/** Native nav bar (transparent, back chevron only) — the header row sits in it. */
const NAV_BAR = 44;
/** Room for the native back chevron where the web draws its 36px back button. */
const BACK_GUTTER = 56;

interface NormalizedSegment {
  id: string;
  sourceText: string;
  translatedText: string;
  mergedFromIds?: string[];
  combinedSourceText?: string;
  combinedTranslatedText?: string;
}

export default function SessionScreen() {
  const { id, completed } = useLocalSearchParams<{
    id: string;
    completed?: string;
  }>();
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const live = useQuery(api.sessions.getSession, { sessionId: id });
  const saveSummary = useMutation(api.sessions.saveSummary);
  // Plan usage (web usePlan) — gates Generate behind the summary cap.
  const usage = useQuery(api.subscriptions.getMyUsageThisMonth);
  const deleteSession = useMutation(api.sessions.deleteSession);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deletedRef = useRef(false);
  const lastRef = useRef<typeof live>(undefined);
  if (live) lastRef.current = live;
  // After a confirmed delete the query flips to null; keep the last snapshot on
  // screen while the dialog plays its exit and the screen pops.
  const session = live === null && deletedRef.current ? lastRef.current : live;
  const isCompleted = completed === "1";

  const sticky = useStaticStickyBottom(200);

  const segments: NormalizedSegment[] = useMemo(
    () =>
      session?.segments.map((s) => ({
        id: s.id,
        sourceText: s.sourceText,
        translatedText: s.translatedText,
        mergedFromIds: s.mergedFromIds,
        combinedSourceText: s.combinedSourceText,
        combinedTranslatedText: s.combinedTranslatedText,
      })) ?? [],
    [session?.segments],
  );

  // Verse/hadith merges: the parent shows the combined text, children hide.
  const visibleRows = useMemo(() => {
    const suppressed = new Set<string>();
    for (const s of segments)
      for (const c of s.mergedFromIds ?? []) suppressed.add(c);
    return segments
      .filter((s) => !suppressed.has(s.id))
      .map((s) => ({
        id: s.id,
        sourceText: s.combinedSourceText ?? s.sourceText,
        translatedText: s.combinedTranslatedText ?? s.translatedText,
      }));
  }, [segments]);

  const topPad = insets.top;

  // ScreenEnter is the root of every branch so the route enter plays ONCE on
  // mount (with the skeleton, as on the web) and the skeleton → content swap
  // stays instant.
  if (session === undefined) {
    return (
      <ScreenEnter replayOnFocus={false}>
        <LoadingSkeleton topPad={topPad} />
      </ScreenEnter>
    );
  }
  if (session === null) {
    return (
      <ScreenEnter replayOnFocus={false}>
        <View style={styles.screen}>
          <View style={[styles.header, { paddingTop: topPad }]}>
            <View style={styles.headerRow}>
              <Text style={styles.notFoundTitle}>
                {t("session.notFoundTitle")}
              </Text>
            </View>
          </View>
          <View style={styles.notFound}>
            <Text style={styles.notFoundBody}>{t("session.notFoundBody")}</Text>
          </View>
        </View>
      </ScreenEnter>
    );
  }

  const sourceRtl = isRtl(session.sourceLanguage);
  const targetRtl = isRtl(session.targetLanguage);
  const sourceSize = baseFontSize(session.sourceLanguage);
  const targetSize = baseFontSize(session.targetLanguage);
  const title = session.title || t("session.untitled");

  const copyText = () => {
    const lines: string[] = [];
    for (const seg of visibleRows) {
      lines.push(seg.sourceText);
      if (seg.translatedText) lines.push(`  → ${seg.translatedText}`);
      lines.push("");
    }
    return lines.join("\n").trim();
  };

  const shareMarkdown = () => {
    const lines: string[] = [];
    lines.push(`# ${session.title ?? t("session.untitled")}`);
    lines.push("");
    lines.push(
      `*${langName(session.sourceLanguage)} → ${langName(session.targetLanguage)} · ${formatDate(
        session.createdAt,
      )} · ${formatDuration(session.duration)}*`,
    );
    lines.push("");
    if (session.summary) {
      lines.push(`## ${t("session.mdSummary")}`);
      lines.push("");
      lines.push(session.summary);
      lines.push("");
    }
    lines.push(`## ${t("session.mdTranscript")}`);
    lines.push("");
    for (const seg of visibleRows) {
      lines.push(`> ${seg.sourceText}`);
      if (seg.translatedText) {
        lines.push("");
        lines.push(seg.translatedText);
      }
      lines.push("");
    }
    const md = lines.join("\n").trimEnd() + "\n";
    const slug =
      (session.title ?? "session")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40) || "session";
    const date = new Date(session.createdAt).toISOString().slice(0, 10);
    void Share.share({
      message: md,
      title: `livetranscribe-${date}-${slug}.md`,
    }).catch(() => {});
  };

  const aiSegments = visibleRows.map((r) => ({
    id: r.id,
    sourceText: r.sourceText,
    translatedText: r.translatedText,
  }));

  return (
    <ScreenEnter replayOnFocus={false}>
      <View style={styles.screen}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: topPad }]}>
          {isCompleted ? (
            <View
              style={[styles.headerRow, { justifyContent: "space-between" }]}
            >
              <View style={styles.completeTitle}>
                <View style={styles.checkDot}>
                  <SymbolView
                    name="checkmark"
                    tintColor="#0A0F1C"
                    size={12}
                    weight="bold"
                  />
                </View>
                <Text style={styles.completeText}>{t("record.complete")}</Text>
              </View>
              <Text style={styles.completeDuration}>
                {formatDuration(session.duration)}
              </Text>
            </View>
          ) : (
            <View style={styles.headerRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.duration}>
                  {formatDuration(session.duration)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Language pair */}
        <View style={styles.langRow}>
          <Text style={styles.langSource}>
            {langName(session.sourceLanguage)}
          </Text>
          <Text style={styles.langArrow}>→</Text>
          <Text style={styles.langTarget}>
            {langName(session.targetLanguage)}
          </Text>
        </View>

        {/* Body (static sticky-bottom scroller) */}
        <Animated.ScrollView
          ref={sticky.ref}
          onScroll={sticky.onScroll}
          scrollEventThrottle={sticky.scrollEventThrottle}
          onLayout={sticky.onLayout}
          onContentSizeChange={sticky.onContentSizeChange}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={styles.body}
          style={{ flex: 1 }}
        >
          <SummarySection
            transcriptForLLM={segments
              .map((s) => s.translatedText || s.sourceText)
              .join(" ")}
            hasSegments={segments.length > 0}
            targetLang={session.targetLanguage}
            existingSummary={session.summary ?? null}
            existingSummaryLang={session.summaryLanguage ?? null}
            onSummaryGenerated={(summary, language) =>
              saveSummary({
                sessionId: session._id as Id<"sessions">,
                summary,
                summaryLanguage: language,
              }).catch(() => {})
            }
            // Web session-body: free users past the monthly summary cap get
            // the UpgradeCard in place of Generate (idle only).
            idleReplacement={
              usage && !usage.canSummarize ? (
                <UpgradeCard
                  title={t("record.summaryLimitTitle")}
                  message={t("record.summaryLimitBody", {
                    limit: String(usage.summariesLimit ?? ""),
                  })}
                />
              ) : undefined
            }
          />

          {/* Pro AI tools — study notes, Ask-the-lecture, any-language translation. */}
          <ProAiTools
            sessionId={session._id}
            sourceLanguage={session.sourceLanguage}
            targetLanguage={session.targetLanguage}
            segments={aiSegments}
          />

          <Text style={styles.sectionLabel}>
            {t("session.transcriptLabel")}
          </Text>

          {segments.length === 0 ? (
            <Text style={styles.noTranscript}>{t("record.noTranscript")}</Text>
          ) : null}

          {visibleRows.map((seg) => (
            <View key={seg.id} style={styles.pair}>
              <View
                style={[
                  styles.sourceCard,
                  sourceRtl
                    ? { borderRightWidth: 3, borderRightColor: BLUE_EDGE }
                    : { borderLeftWidth: 3, borderLeftColor: BLUE_EDGE },
                ]}
              >
                <Text
                  style={[
                    styles.sourceText,
                    {
                      fontSize: sourceSize,
                      lineHeight: sourceSize * 1.7,
                      fontWeight: sourceRtl ? "500" : "400",
                    },
                    sourceRtl ? styles.rtl : styles.ltr,
                  ]}
                >
                  {seg.sourceText}
                </Text>
              </View>
              {seg.translatedText ? (
                <View
                  style={[
                    styles.translationCard,
                    targetRtl
                      ? { borderRightWidth: 3, borderRightColor: GREEN_EDGE }
                      : { borderLeftWidth: 3, borderLeftColor: GREEN_EDGE },
                  ]}
                >
                  <Text
                    style={[
                      styles.translatedText,
                      {
                        fontSize: targetSize,
                        lineHeight: targetSize * 1.7,
                        fontWeight: targetRtl ? "600" : "500",
                      },
                      targetRtl ? styles.rtl : styles.ltr,
                    ]}
                  >
                    {renderLinks(seg.translatedText, seg.id)}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </Animated.ScrollView>

        {/* Action bar */}
        {isCompleted ? (
          <View
            style={[
              styles.footer,
              { paddingBottom: insets.bottom + 12, gap: 8 },
            ]}
          >
            <View style={styles.footerRow}>
              <CopyButton variant="completed" getText={copyText} />
              <PressableScale
                scaleTo={0.98}
                duration={200}
                pressColors={{
                  borderColor: [C.borderLight, C.accent],
                  backgroundColor: [C.surface, C.surfaceLight],
                  duration: 200,
                }}
                onPress={() =>
                  router.dismissTo({
                    pathname: "/",
                    params: { autostart: "1" },
                  })
                }
                accessibilityRole="button"
                style={[styles.secondary, styles.radius16]}
              >
                <SymbolView name="mic" tintColor={C.t2} size={16} />
                <Text style={styles.secondaryText}>
                  {t("record.newRecording")}
                </Text>
              </PressableScale>
            </View>
            <PressableScale
              scaleTo={0.98}
              translateYTo={-2}
              duration={200}
              pressColors={{
                backgroundColor: [C.accent, DONE_BRIGHT],
                duration: 200,
              }}
              onPress={() =>
                router.canGoBack() ? router.back() : router.dismissTo("/")
              }
              accessibilityRole="button"
              style={styles.done}
            >
              <SymbolView
                name="checkmark"
                tintColor="#0A0F1C"
                size={16}
                weight="bold"
              />
              <Text style={styles.doneText}>{t("session.done")}</Text>
            </PressableScale>
          </View>
        ) : (
          <View
            style={[
              styles.footer,
              styles.footerRow,
              { paddingBottom: insets.bottom + 12 },
            ]}
          >
            <CopyButton variant="detail" getText={copyText} />
            <PressableScale
              scaleTo={0.98}
              onPress={shareMarkdown}
              accessibilityRole="button"
              accessibilityLabel={t("session.shareMdA11y")}
              style={[styles.secondary, styles.radius12]}
            >
              <SymbolView
                name="square.and.arrow.up"
                tintColor={C.t2}
                size={16}
              />
              <Text style={styles.secondaryText}>{t("session.shareMd")}</Text>
            </PressableScale>
            <PressableScale
              scaleTo={0.98}
              onPress={() => setDeleteOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("session.delete")}
              style={[styles.iconButton, styles.radius12]}
            >
              <SymbolView name="trash" tintColor={C.red} size={16} />
            </PressableScale>
          </View>
        )}

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={(o) => {
            setDeleteOpen(o);
            // Let the dialog finish its 150ms exit, then pop back to History
            // (where the row plays its own exit).
            if (!o && deletedRef.current) setTimeout(() => router.back(), 160);
          }}
          title={t("session.deleteTitle")}
          message={t("session.deleteMessage")}
          confirmLabel={t("session.delete")}
          destructive
          onConfirm={async () => {
            deletedRef.current = true;
            try {
              await deleteSession({ sessionId: session._id as Id<"sessions"> });
            } catch (e) {
              deletedRef.current = false;
              throw e;
            }
          }}
        />
      </View>
    </ScreenEnter>
  );
}

// ─── Copy button ────────────────────────────────────────────────────────────

type CopyStatus = "idle" | "copied" | "failed";
const COPY_COLOR: Record<CopyStatus, string> = {
  idle: C.t2,
  copied: C.accent,
  failed: C.amber,
};

/**
 * detail    : page.tsx — colour/icon/label swap SNAP, press .98 / 150ms.
 * completed : completed-view.tsx — label colour FADES 200ms tw (icon snaps),
 *             press .98 / 200ms, border → accent + bg → surfaceLight while
 *             pressed (hover), 200ms.
 */
function CopyButton({
  variant,
  getText,
}: {
  variant: "detail" | "completed";
  getText: () => string;
}) {
  const t = useT();
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );

  const fade = variant === "completed";
  const from = useSharedValue<string>(C.t2);
  const to = useSharedValue<string>(C.t2);
  const p = useSharedValue(1);
  const shown = useRef<string>(C.t2);

  useEffect(() => {
    const next = COPY_COLOR[status];
    if (next === shown.current) return;
    if (fade) {
      from.value = shown.current;
      to.value = next;
      p.value = 0;
      p.value = withTiming(1, {
        duration: 200,
        easing: EASE.tw,
        reduceMotion: ReduceMotion.Never,
      });
    } else {
      from.value = next;
      to.value = next;
      p.value = 1;
    }
    shown.current = next;
  }, [status, fade, from, to, p]);

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [from.value, to.value]) as string,
  }));

  const onPress = async () => {
    if (timer.current) clearTimeout(timer.current);
    let ok = true;
    try {
      await Clipboard.setStringAsync(getText());
    } catch {
      ok = false;
    }
    setStatus(ok ? "copied" : "failed");
    if (ok)
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    timer.current = setTimeout(() => setStatus("idle"), ok ? 1500 : 2000);
  };

  const label =
    status === "copied"
      ? t("record.copied")
      : status === "failed"
        ? t("session.copyFailed")
        : t("record.copy");
  const color = COPY_COLOR[status];

  return (
    <PressableScale
      scaleTo={0.98}
      duration={fade ? 200 : 150}
      pressColors={
        fade
          ? {
              borderColor: [C.borderLight, C.accent],
              backgroundColor: [C.surface, C.surfaceLight],
              duration: 200,
            }
          : undefined
      }
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLiveRegion="polite"
      style={[styles.secondary, fade ? styles.radius16 : styles.radius12]}
    >
      <SymbolView
        name={status === "copied" ? "checkmark" : "doc.on.doc"}
        tintColor={color}
        size={16}
      />
      <Animated.Text style={[styles.secondaryText, labelStyle]}>
        {label}
      </Animated.Text>
    </PressableScale>
  );
}

// ─── Loading skeleton (page.tsx session === undefined) ──────────────────────

function LoadingSkeleton({ topPad }: { topPad: number }) {
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <View
          style={[
            styles.headerRow,
            {
              gap: 6,
              flexDirection: "column",
              alignItems: "stretch",
              justifyContent: "center",
            },
          ]}
        >
          <Skeleton style={{ width: "55%", height: 14 }} />
          <Skeleton style={{ width: 60, height: 10 }} />
        </View>
      </View>
      <View style={styles.langRow}>
        <Skeleton style={{ width: 140, height: 12 }} />
      </View>
      <View style={styles.body}>
        <Skeleton style={{ width: "100%", height: 46 }} rounded={16} />
        <View style={{ marginTop: 20 }}>
          <SegmentSkeleton widths={["92%", "68%"]} />
          <SegmentSkeleton widths={["86%", "74%"]} />
          <SegmentSkeleton widths={["95%", "60%"]} />
        </View>
      </View>
    </View>
  );
}

const BLUE_EDGE = "rgba(59, 130, 246, 0.4)"; // blue + "66"
const GREEN_EDGE = "rgba(46, 204, 113, 0.4)"; // accent + "66"
/** brightness(1.1) of #2ECC71 — the Done button's hover, mapped to press. */
const DONE_BRIGHT = "#33E17C";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingLeft: BACK_GUTTER,
    paddingRight: 20,
    paddingBottom: 8,
  },
  headerRow: {
    minHeight: NAV_BAR,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: { color: C.w, fontSize: 15, fontWeight: "700" },
  duration: { color: C.t4, fontSize: 11, marginTop: 1 },
  completeTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  completeText: { color: C.w, fontSize: 16, fontWeight: "700" },
  completeDuration: {
    color: C.t2,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Menlo",
    fontVariant: ["tabular-nums"],
  },
  notFoundTitle: { color: C.w, fontSize: 16, fontWeight: "700" },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  notFoundBody: {
    color: C.t3,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  langRow: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  langSource: { color: C.t3, fontSize: 12, fontWeight: "600" },
  langArrow: { color: C.t4, fontSize: 12 },
  langTarget: { color: C.accent, fontSize: 12, fontWeight: "600" },
  body: { paddingHorizontal: 20, paddingVertical: 16 },
  sectionLabel: {
    color: C.t4,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.55,
    marginBottom: 12,
  },
  noTranscript: {
    color: C.t4,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 32,
  },
  pair: { marginBottom: 16 },
  sourceCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 6,
    backgroundColor: "rgba(59, 130, 246, 0.08)", // blue + "14"
  },
  sourceText: { color: C.t2 },
  translationCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(46, 204, 113, 0.06)", // accent + "10"
  },
  translatedText: { color: C.w },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  ltr: { writingDirection: "ltr", textAlign: "left" },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  footerRow: { flexDirection: "row", gap: 8 },
  secondary: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  radius12: { borderRadius: 12 },
  radius16: { borderRadius: 16 },
  secondaryText: { color: C.t2, fontSize: 14, fontWeight: "600" },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  done: {
    height: 48,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.accent,
    boxShadow: "0 0 18px rgba(46, 204, 113, 0.19)",
  },
  doneText: { color: "#0A0F1C", fontSize: 14, fontWeight: "700" },
});
