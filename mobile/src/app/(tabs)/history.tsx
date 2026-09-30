/**
 * History — port of src/app/(app)/history/page.tsx.
 *
 * Motion (web → native):
 *   - route enter (template.tsx): opacity 0→1 + 8px rise, 200ms CSS ease
 *     (HistoryEnter, local; off under Reduce Motion). The web never paints
 *     the page before the template remounts, so it only ever animates UP from
 *     the enter pose. Native matches that: the pose is reset to 0 on TAB blur
 *     (while the screen is hidden), so the first frame NativeTabs shows on the
 *     way back is already the enter pose; it is NOT reset on a root-stack push
 *     blur (session/[id]), because a swipe/back pop reveals the list fully
 *     before focus fires — replaying there would blink it out and back.
 *   - loading: 4 synced animate-pulse skeletons (84 tall, r16, gap 12); the
 *     skeleton → list swap is instant, like the web.
 *   - list (web auto-animate {duration 220, easing (.22,1,.36,1)}):
 *       add    : 330ms, WAAPI "ease-in" over the iteration with the keyframes
 *                held at {scale .98, opacity 0} until 50%, then → 1
 *       remove : 220ms "ease-out" (0,0,.58,1), scale 1→.98 + opacity 1→0;
 *                the ghost stays overlaid while siblings reflow.
 *       scroll : auto-animate's adjustScroll() — 220ms of rAF window.scrollTo
 *                so the page never jumps when a removal shrinks it. On Fabric
 *                the exiting ghost does NOT hold its slot and UIScrollView
 *                does not clamp contentOffset when contentSize shrinks (RN's
 *                RCTScrollViewComponentView just sets contentSize), so a
 *                removal near the bottom would jump or leave a stuck
 *                overscroll. ShrinkSpacer fixes both: the same commit that
 *                drops the rows appends a spacer of exactly the removed
 *                height (content size unchanged → no jump), the spacer glides
 *                to 0 over 220ms bezier(.22,1,.36,1) (in step with the
 *                reflow), and a UI-thread reaction clamps the offset to the
 *                shrinking max every frame (scrollTo = the rAF loop).
 *                Under Reduce Motion the spacer collapses instantly and the
 *                offset is clamped once (the browser's native clamp).
 *       reflow : 220ms bezier(.22,1,.36,1) (itemLayoutAnimation)
 *     Rows present when the list first mounts do NOT animate — not just the
 *     first render batch (skipEnteringExitingAnimations) but every later
 *     FlatList batch and every virtualisation remount: only ids that joined
 *     the visible list in the last FRESH_MS get `entering` (freshIds). Reduce Motion → all off (auto-animate
 *     does not attach under prefers-reduced-motion).
 *   - empty / no-match states: the web unmounts the list and snaps the
 *     message in; native keeps ONE list mounted (rows keep their exit/enter
 *     across the 0-match boundary) and fades the message in/out (220ms). The
 *     message sits in a fixed viewport-high slot, so the shrinking spacer
 *     below it never drags it off centre.
 *   - Rename (PromptDialog) and Delete (ConfirmDialog) are hosted here, not
 *     in the row, so a deleted row's exit plays WITH the dialog's exit.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  cancelAnimation,
  Easing,
  LinearTransition,
  measure,
  ReduceMotion,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import { useFocusEffect, useNavigation } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/api";
import type { Id } from "@convex/dataModel";
import { SessionRow, type SessionListItem } from "~/components/session-row";
import { PromptDialog } from "~/components/prompt-dialog";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { PressableScale, Skeleton } from "~/components/motion";
import { langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { EASE, EASE_FN, TW_ENTER, TW_EXIT, twEnter, twExit, useReduceMotion } from "~/lib/motion";
import { rtlRow, rtlText, useLocale } from "~/i18n";

/**
 * template.tsx route enter for a TAB screen that also sits under a root stack.
 * Plays on first focus and on focus after a tab switch; the pose is reset on
 * tab blur (screen hidden) so the first painted frame is the enter pose. A
 * blur caused by a root-stack push leaves the pose alone, so the pop back
 * shows the list as it was — no blink, no replay.
 */
function HistoryEnter({ children }: { children: ReactNode }) {
  const reduce = useReduceMotion();
  const navigation = useNavigation();
  const p = useSharedValue(reduce ? 1 : 0);
  const needsEnter = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (reduce) {
        cancelAnimation(p);
        p.value = 1;
        needsEnter.current = false;
      } else if (needsEnter.current) {
        needsEnter.current = false;
        p.value = 0;
        p.value = withTiming(1, { duration: 200, easing: EASE.css, reduceMotion: ReduceMotion.Never });
      }
      return () => {
        if (reduce) return;
        // Tab switch → the tabs navigator is still focused in the root stack.
        // Root-stack push (session/[id]) → it is not; keep the rest pose.
        const parent = navigation.getParent();
        const tabBlur = parent ? parent.isFocused() : true;
        if (tabBlur) {
          cancelAnimation(p);
          p.value = 0;
          needsEnter.current = true;
        }
      };
    }, [reduce, navigation, p])
  );

  const animated = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: 8 * (1 - p.value) }],
  }));

  return <Animated.View style={[{ flex: 1 }, animated]}>{children}</Animated.View>;
}

// auto-animate's add(): WAAPI easing "ease-in" over the whole iteration, and
// the keyframes hold the start pose until offset .5, then run linearly.
const easeIn = Easing.bezierFn(0.42, 0, 1, 1);
const heldEaseIn = (t: number) => {
  "worklet";
  const p = easeIn(t);
  return p < 0.5 ? 0 : (p - 0.5) * 2;
};
const cardEnter = twEnter({ opacity: 0, scale: 0.98, duration: 330, easing: heldEaseIn, reduce: "system" });
const cardExit = twExit({
  opacity: 0,
  scale: 0.98,
  duration: 220,
  easing: Easing.bezier(0, 0, 0.58, 1),
  reduce: "system",
});
const cardReflow = LinearTransition.duration(220).easing(EASE.smooth);
const messageIn = twEnter({ opacity: 0, duration: 220 });
const messageOut = twExit({ opacity: 0, duration: 220 });

/** auto-animate duration — the reflow, the ghost and the scroll window. */
const LIST_MS = 220;
const LIST_PAD_TOP = 16;
const LIST_PAD_BOTTOM = 120;
const ROW_GAP = 10;
/** How long a newly joined id may still play its add animation on mount. */
const FRESH_MS = 600;

/** Scroll-compensation bookkeeping, derived from the visible id list. */
interface Shrink {
  key: string | null;
  ids: string[];
  /** Bumps on every removal → remounts the spacer at its new start height. */
  token: number;
  from: number;
  start: number;
  duration: number;
}

export default function HistoryScreen() {
  const sessions = useQuery(api.sessions.getUserSessions);
  const updateTitle = useMutation(api.sessions.updateTitle);
  const deleteSession = useMutation(api.sessions.deleteSession);
  const reduce = useReduceMotion();
  const { t, dir } = useLocale();
  const [query, setQuery] = useState("");

  const listRef = useAnimatedRef<FlatList<SessionListItem>>();
  const headRef = useAnimatedRef<Animated.View>();
  const scrollY = useScrollOffset(listRef);
  const viewportH = useSharedValue(0);
  // JS copy for the empty / no-match message's fixed slot (see `messageSlot`).
  const [listH, setListH] = useState(0);
  const rowHeights = useRef(new Map<string, number>());
  /**
   * Ids that just joined the visible list (a new session, or a card coming
   * back when the search is cleared) → the time they joined. Only these get
   * the add animation, and only within FRESH_MS of joining: rows present at
   * list mount (FlatList renders past initialNumToRender in later batches,
   * where skipEnteringExitingAnimations no longer applies) and rows remounted
   * by virtualisation while scrolling never animate — auto-animate skips
   * initial children and never re-adds on scroll.
   */
  const freshIds = useRef(new Map<string, number>());

  const [renameTarget, setRenameTarget] = useState<SessionListItem | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Title + language names + summary, case-insensitive substring (web useMemo).
  const filtered = useMemo(() => {
    if (!sessions) return undefined;
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [s.title ?? "", langName(s.sourceLanguage), langName(s.targetLanguage), s.summary ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [sessions, query]);

  // Removal → spacer of the removed height, set during render (derived state)
  // so it lands in the SAME commit that drops the rows.
  const ids = useMemo<string[]>(() => filtered?.map((s) => s._id as string) ?? [], [filtered]);
  const idsKey = filtered ? ids.join("|") : null;
  const [shrink, setShrink] = useState<Shrink>({
    key: idsKey,
    ids,
    token: 0,
    from: 0,
    start: 0,
    duration: LIST_MS,
  });
  if (idsKey !== shrink.key) {
    let next: Shrink = { ...shrink, key: idsKey, ids };
    if (shrink.key !== null && idsKey !== null) {
      const before = new Set(shrink.ids);
      const joinedAt = Date.now();
      for (const id of ids) if (!before.has(id)) freshIds.current.set(id, joinedAt);
      const keep = new Set(ids);
      const known = [...rowHeights.current.values()];
      // A virtualised row that never laid out → the average card height.
      const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 84;
      let removed = 0;
      for (const id of shrink.ids) {
        if (!keep.has(id)) removed += (rowHeights.current.get(id) ?? fallback) + ROW_GAP;
      }
      if (removed > 0) {
        const now = Date.now();
        const p = shrink.duration > 0 ? Math.min(1, (now - shrink.start) / shrink.duration) : 1;
        const residual = shrink.token > 0 ? shrink.from * (1 - EASE_FN.smooth(p)) : 0;
        next = {
          ...next,
          token: shrink.token + 1,
          from: removed + residual,
          start: now,
          duration: reduce ? 0 : LIST_MS,
        };
      }
    }
    setShrink(next);
  }

  const isFresh = (id: string) => {
    const at = freshIds.current.get(id);
    if (at === undefined) return false;
    if (Date.now() - at > FRESH_MS) {
      freshIds.current.delete(id);
      return false;
    }
    return true;
  };

  const total = sessions?.length ?? 0;
  const visible = filtered?.length ?? 0;
  const count =
    sessions === undefined
      ? t("history.loading")
      : query.trim()
        ? t("session.countOf", { visible, total })
        : total === 1
          ? t("session.countOne")
          : t("session.countMany", { n: total });

  const openRename = (s: SessionListItem) => {
    setRenameTarget(s);
    setRenameOpen(true);
  };
  const openDelete = (s: SessionListItem) => {
    setDeleteTarget(s);
    setDeleteOpen(true);
  };

  // The message gets a FIXED slot equal to the viewport's content area rather
  // than `flex: 1`: the ShrinkSpacer footer shares the content container while
  // it glides to 0, and a flex-filled message would slide down by half the
  // removed height as it shrank. Fixed → it fades in already centred (web).
  const messageSlot =
    listH > 0 ? { height: Math.max(0, listH - LIST_PAD_TOP - LIST_PAD_BOTTOM) } : styles.messageFlex;

  const empty =
    total === 0 ? (
      <Animated.View key="empty" entering={messageIn} exiting={messageOut} style={[styles.message, messageSlot]}>
        <Text style={styles.messageTitle}>{t("history.emptyTitle")}</Text>
        <Text style={styles.messageSub}>{t("history.emptySub")}</Text>
      </Animated.View>
    ) : (
      <Animated.View key="nomatch" entering={messageIn} exiting={messageOut} style={[styles.message, messageSlot]}>
        <Text style={styles.messageTitle}>{t("session.noMatch", { q: query })}</Text>
        <Text style={styles.clearLink} onPress={() => setQuery("")} accessibilityRole="button">
          {t("history.clearSearch")}
        </Text>
      </Animated.View>
    );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <HistoryEnter>
        <View style={styles.header}>
          <Text style={[styles.sectionLabel, rtlText(dir)]}>{t("nav.history")}</Text>
          <View style={[styles.titleRow, rtlRow(dir)]}>
            <Text style={[styles.title, rtlText(dir)]} accessibilityRole="header">
              {t("history.title")}
            </Text>
            <Text style={styles.count}>{count}</Text>
          </View>

          {total > 0 ? (
            <Animated.View entering={TW_ENTER.fade} exiting={TW_EXIT.fade} style={[styles.search, rtlRow(dir)]}>
              <SymbolView name="globe" tintColor={C.t4} size={14} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("history.searchPlaceholder")}
                placeholderTextColor={C.t4}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                style={[styles.searchInput, rtlText(dir)]}
              />
              {query ? (
                <Animated.View entering={TW_ENTER.fade} exiting={TW_EXIT.fade}>
                  <PressableScale
                    scaleTo={1}
                    onPress={() => setQuery("")}
                    accessibilityRole="button"
                    accessibilityLabel={t("session.clearSearchA11y")}
                    hitSlop={10}
                    style={styles.clear}
                  >
                    <SymbolView name="xmark" tintColor={C.t3} size={10} />
                  </PressableScale>
                </Animated.View>
              ) : null}
            </Animated.View>
          ) : null}
        </View>

        {filtered === undefined ? (
          <View style={styles.skeletons}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ width: "100%", height: 84 }} rounded={16} />
            ))}
          </View>
        ) : (
          <Animated.FlatList
            ref={listRef}
            data={filtered}
            keyExtractor={(s: SessionListItem) => s._id}
            renderItem={({ item }: { item: SessionListItem }) => (
              <Animated.View
                entering={reduce || !isFresh(item._id) ? undefined : cardEnter}
                exiting={reduce ? undefined : cardExit}
                onLayout={(e: LayoutChangeEvent) => {
                  rowHeights.current.set(item._id, e.nativeEvent.layout.height);
                }}
                style={styles.rowWrap}
              >
                <SessionRow s={item} variant="history" onRename={openRename} onDelete={openDelete} />
              </Animated.View>
            )}
            itemLayoutAnimation={reduce ? undefined : cardReflow}
            skipEnteringExitingAnimations
            ListEmptyComponent={empty}
            ListHeaderComponent={<Animated.View ref={headRef} collapsable={false} style={styles.marker} />}
            ListFooterComponent={
              shrink.token > 0 ? (
                <ShrinkSpacer
                  key={shrink.token}
                  from={shrink.from}
                  duration={shrink.duration}
                  listRef={listRef}
                  headRef={headRef}
                  scrollY={scrollY}
                  viewportH={viewportH}
                />
              ) : null
            }
            onLayout={(e: LayoutChangeEvent) => {
              viewportH.value = e.nativeEvent.layout.height;
              setListH(e.nativeEvent.layout.height);
            }}
            contentContainerStyle={styles.list}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          />
        )}
      </HistoryEnter>

      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t("session.renameTitle")}
        label={t("session.renameLabel")}
        placeholder={t("session.renamePlaceholder")}
        defaultValue={renameTarget?.title ?? ""}
        onSave={async (next) => {
          if (!renameTarget || next === renameTarget.title) return;
          await updateTitle({ sessionId: renameTarget._id as Id<"sessions">, title: next });
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("session.deleteTitle")}
        message={t("session.deleteMessage")}
        confirmLabel={t("session.delete")}
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteSession({ sessionId: deleteTarget._id as Id<"sessions"> });
        }}
      />
    </SafeAreaView>
  );
}

/**
 * auto-animate adjustScroll() port. Mounts at `from` px (the removed rows'
 * height, plus any residual of a spacer that was still shrinking), glides to
 * 0 and, every frame, clamps the scroll offset to the shrinking maximum:
 *   contentEnd = padTop + (tail.pageY − head.pageY) + spacer + padBottom
 * Both markers live in the content, so their pageY difference is independent
 * of the (possibly stale) scroll offset baked into a measurement.
 */
function ShrinkSpacer({
  from,
  duration,
  listRef,
  headRef,
  scrollY,
  viewportH,
}: {
  from: number;
  duration: number;
  listRef: AnimatedRef<FlatList<SessionListItem>>;
  headRef: AnimatedRef<Animated.View>;
  scrollY: SharedValue<number>;
  viewportH: SharedValue<number>;
}) {
  const h = useSharedValue(from);
  const tailRef = useAnimatedRef<Animated.View>();

  useEffect(() => {
    h.value = withTiming(0, { duration, easing: EASE.smooth, reduceMotion: ReduceMotion.Never });
  }, [h, duration]);

  useAnimatedReaction(
    () => h.value,
    (v) => {
      const head = measure(headRef);
      const tail = measure(tailRef);
      if (!head || !tail || viewportH.value <= 0) return;
      const contentEnd = LIST_PAD_TOP + (tail.pageY - head.pageY) + v + LIST_PAD_BOTTOM;
      const maxY = Math.max(0, contentEnd - viewportH.value);
      if (scrollY.value > maxY + 0.5) scrollTo(listRef, 0, maxY, false);
    }
  );

  const style = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <View pointerEvents="none">
      <Animated.View ref={tailRef} collapsable={false} style={styles.marker} />
      <Animated.View style={style} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionLabel: {
    color: C.t3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.88,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  titleRow: { alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 },
  title: { color: C.w, fontSize: 24, fontWeight: "700", flexShrink: 1 },
  count: { color: C.t3, fontSize: 12 },
  search: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  searchInput: { flex: 1, color: C.w, fontSize: 13, paddingVertical: 0 },
  clear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surfaceLight,
  },
  skeletons: { paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  list: { paddingHorizontal: 20, paddingTop: LIST_PAD_TOP, paddingBottom: LIST_PAD_BOTTOM, flexGrow: 1 },
  rowWrap: { marginBottom: ROW_GAP },
  marker: { height: 0 },
  message: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 48 },
  messageFlex: { flex: 1 },
  messageTitle: { color: C.t3, fontSize: 14, lineHeight: 20, textAlign: "center" },
  messageSub: { color: C.t4, fontSize: 12, lineHeight: 16, marginTop: 4, textAlign: "center" },
  clearLink: {
    color: C.accent,
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
    marginTop: 8,
  },
});
