/**
 * SessionRow — the History list card, src/components/session/session-card.tsx.
 *
 *   - card link: NO press effect. The web link only declares an inert
 *     `transition-colors` with no hover/active colour (and globals.css has no
 *     a:hover rule), so nothing changes visually; native matches that. The
 *     Record idle "Recent" list (recent-sessions.tsx) is the same: plain.
 *   - kebab: bg transparent → white/5 while pressed (hover), 150ms tw; icon
 *     colour t3 → w while the menu is open (web transition-colors, 150ms tw).
 *     The t3 glyph stays fully opaque and only the white glyph fades in over
 *     it, so the blend is an exact linear colour mix (no mid-transition dim).
 *   - options flyout BESIDE the kebab (gap 8, margin 8, flips side) via
 *     AnchoredPopover — fades + 4px slide in AND out (200ms CSS ease; the web
 *     menu snaps, which breaks the fluid-menus rule);
 *   - Rename item bg → black/20, Delete item bg → red-500/10 while pressed,
 *     150ms tw.
 *   Rename / Delete are raised to the list (onRename / onDelete) so the
 *   dialogs live OUTSIDE the row: a deleted row's exit then plays together
 *   with the dialog's own exit instead of cutting it (web bug).
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import { formatDate, formatDuration, langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { TW } from "~/lib/motion";
import { rtlRow, rtlText, useLocale } from "~/i18n";
import { AnchoredPopover, PressableScale } from "~/components/motion";

export interface SessionListItem {
  _id: string;
  title?: string;
  firstSegmentText?: string;
  sourceLanguage: string;
  targetLanguage: string;
  duration: number;
  summary?: string;
  createdAt: number;
}

export interface SessionRowProps {
  s: SessionListItem;
  /** Kept for call-site compatibility; the only card is the History card. */
  variant?: "history";
  /** History card menu → Rename (the list hosts the PromptDialog). */
  onRename?: (s: SessionListItem) => void;
  /** History card menu → Delete (the list hosts the ConfirmDialog). */
  onDelete?: (s: SessionListItem) => void;
}

/** Popover exit (200ms) + a frame: two RN Modals must not overlap on iOS. */
const AFTER_MENU_EXIT_MS = 220;
const TW_NEVER = { ...TW, reduceMotion: ReduceMotion.Never };

export function SessionRow({ s, onRename, onDelete }: SessionRowProps) {
  return <HistoryCard s={s} onRename={onRename} onDelete={onDelete} />;
}

function useTitle(s: SessionListItem) {
  const { t } = useLocale();
  return s.title || s.firstSegmentText || t("session.untitled");
}

function DocTile({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.tile, style]}>
      <SymbolView name="doc" tintColor={C.t3} size={16} />
    </View>
  );
}

// ─── History card ───────────────────────────────────────────────────────────

function HistoryCard({
  s,
  onRename,
  onDelete,
}: {
  s: SessionListItem;
  onRename?: (s: SessionListItem) => void;
  onDelete?: (s: SessionListItem) => void;
}) {
  const router = useRouter();
  const { t, dir } = useLocale();
  const title = useTitle(s);
  const [menuOpen, setMenuOpen] = useState(false);
  const kebabRef = useRef<View>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Kebab icon colour t3 → w while the menu is open: the t3 glyph stays at
  // opacity 1 underneath and only the white glyph fades in over it.
  const open = useSharedValue(0);
  useEffect(() => {
    open.value = withTiming(menuOpen ? 1 : 0, TW_NEVER);
  }, [menuOpen, open]);
  const iconOpen = useAnimatedStyle(() => ({ opacity: open.value }));

  const after = (fn: () => void) => {
    setMenuOpen(false);
    timers.current.push(setTimeout(fn, AFTER_MENU_EXIT_MS));
  };

  const hasMenu = !!(onRename || onDelete);

  return (
    <View style={[styles.card, rtlRow(dir)]}>
      <PressableScale
        scaleTo={1}
        onPress={() => router.push({ pathname: "/session/[id]", params: { id: s._id } })}
        accessibilityRole="link"
        accessibilityLabel={title}
        style={[styles.link, rtlRow(dir)]}
      >
        <DocTile style={{ marginTop: 2 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={[styles.titleRow, rtlRow(dir)]}>
            <Text style={[styles.title, { flexShrink: 1 }, rtlText(dir)]} numberOfLines={1}>
              {title}
            </Text>
            {s.summary ? <Text style={styles.badge}>✦ {t("session.summaryBadge")}</Text> : null}
          </View>
          <View style={[styles.metaRow, rtlRow(dir)]}>
            <Text style={styles.meta}>{langName(s.sourceLanguage)}</Text>
            <Text style={styles.meta}>→</Text>
            <Text style={styles.meta}>{langName(s.targetLanguage)}</Text>
            <Text style={styles.meta}>·</Text>
            <Text style={styles.meta}>{formatDate(s.createdAt)}</Text>
            <Text style={styles.meta}>·</Text>
            <Text style={[styles.meta, { fontVariant: ["tabular-nums"] }]}>{formatDuration(s.duration)}</Text>
          </View>
        </View>
      </PressableScale>

      {hasMenu ? (
        <View style={[styles.kebabWrap, dir === "rtl" ? { paddingLeft: 8 } : { paddingRight: 8 }]}>
          <PressableScale
            ref={kebabRef}
            scaleTo={1}
            pressColors={{ backgroundColor: ["rgba(255,255,255,0)", "rgba(255,255,255,0.05)"], duration: 150 }}
            onPress={() => setMenuOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={t("session.options")}
            accessibilityState={{ expanded: menuOpen }}
            hitSlop={4}
            style={styles.kebab}
          >
            <View style={styles.kebabIcon}>
              <SymbolView name="ellipsis" tintColor={C.t3} size={18} style={styles.vertical} />
            </View>
            <Animated.View style={[styles.kebabIcon, iconOpen]}>
              <SymbolView name="ellipsis" tintColor={C.w} size={18} style={styles.vertical} />
            </Animated.View>
          </PressableScale>
        </View>
      ) : null}

      {hasMenu ? (
        <AnchoredPopover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={kebabRef}
          placement={dir === "rtl" ? "right" : "left"}
          gap={8}
          margin={8}
          width={176}
          style={styles.menu}
        >
          {onRename ? (
            <PressableScale
              scaleTo={1}
              pressColors={{ backgroundColor: ["rgba(0,0,0,0)", "rgba(0,0,0,0.2)"], duration: 150 }}
              onPress={() => after(() => onRename(s))}
              accessibilityRole="menuitem"
              style={[styles.item, rtlRow(dir), { borderTopLeftRadius: 11, borderTopRightRadius: 11 }, !onDelete && styles.itemBottom]}
            >
              <SymbolView name="pencil" tintColor={C.t3} size={15} />
              <Text style={[styles.itemText, { color: C.t2 }]}>{t("session.rename")}</Text>
            </PressableScale>
          ) : null}
          {onRename && onDelete ? <View style={styles.divider} /> : null}
          {onDelete ? (
            <PressableScale
              scaleTo={1}
              pressColors={{ backgroundColor: ["rgba(251,44,54,0)", "rgba(251,44,54,0.1)"], duration: 150 }}
              onPress={() => after(() => onDelete(s))}
              accessibilityRole="menuitem"
              style={[styles.item, rtlRow(dir), styles.itemBottom, !onRename && { borderTopLeftRadius: 11, borderTopRightRadius: 11 }]}
            >
              <SymbolView name="trash" tintColor={C.red} size={15} />
              <Text style={[styles.itemText, { color: C.red }]}>{t("session.delete")}</Text>
            </PressableScale>
          ) : null}
        </AnchoredPopover>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  card: {
    alignItems: "stretch",
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  link: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  titleRow: { alignItems: "center", gap: 8, marginBottom: 4 },
  title: { color: C.w, fontSize: 14, fontWeight: "600" },
  badge: {
    flexShrink: 0,
    color: C.accent,
    backgroundColor: C.accentSoft,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.45,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  metaRow: { alignItems: "center", gap: 8, overflow: "hidden" },
  meta: { color: C.t4, fontSize: 11 },
  kebabWrap: { justifyContent: "center", flexShrink: 0 },
  kebab: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  kebabIcon: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  vertical: { width: 18, height: 18, transform: [{ rotate: "90deg" }] },
  menu: {
    borderRadius: 12,
    backgroundColor: C.surface,
    borderColor: C.borderLight,
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.5)",
  },
  item: { alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  itemBottom: { borderBottomLeftRadius: 11, borderBottomRightRadius: 11 },
  itemText: { fontSize: 13, fontWeight: "600" },
  divider: { borderTopWidth: 1, borderTopColor: C.border },
});
