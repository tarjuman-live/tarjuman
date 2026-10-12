/**
 * History filters, two presentations of the same rules:
 *   - iPad: HistoryFilterBar — chips under the search (below);
 *   - phone: HistoryFilterMenuButton — one filter ("hamburger") button beside
 *     the search that opens a panel with every filter (user direction
 *     2026-10-12), so the phone header stays a single compact row.
 *
 * HistoryFilterBar — the filter chips under the History search.
 *
 *   [Date ▾] [Language ▾] [Length ▾] [✦ Summarized]      (one row, scrolls sideways)
 *
 * "Clear filters" is NOT a chip: it lives beside the History count
 * (ClearFiltersLink), so turning a filter on never wraps the row or grows the
 * header — the list below never jumps.
 *
 * Rules (shared, tested): @shared/history-filters. The Language menu only
 * offers pairs the user has actually recorded.
 *
 * Motion (fluid-everything rule):
 *   - chip on/off: bg surface → accentSoft, border borderLight → accent, text +
 *     icon t2 → accent, 200ms Tailwind curve (icons crossfade two tints —
 *     SF Symbol tints can't animate);
 *   - press: scale .97, 150ms; the chevron turns 180° while its menu is open;
 *   - menus: AnchoredPopover (fade + 4px slide, in AND out, 200ms);
 *   - a chip whose label changes width (e.g. "All languages" → "Arabic →
 *     French") pushes its neighbours with LinearTransition, never jumping;
 *   - "Clear filters" fades + scales in/out.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  interpolateColor,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SymbolView, type SFSymbol } from "expo-symbols";
import {
  languagePairs,
  type DateRange,
  type FilterableSession,
  type HistoryFilters,
  type LengthRange,
} from "@shared/history-filters";
import { langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { EASE, TW_ENTER, TW_EXIT, useReduceMotion } from "~/lib/motion";
import { rtlRow, rtlText, useLocale, type TKey } from "~/i18n";
import { AnchoredPopover, PressableScale } from "~/components/motion";
import { Toggle } from "~/components/toggle";

const COLOR_T = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
const REFLOW = LinearTransition.duration(220).easing(EASE.smooth);

const DATE_OPTIONS: { value: DateRange; key: TKey }[] = [
  { value: "any", key: "session.filterAnyTime" },
  { value: "today", key: "session.filterToday" },
  { value: "week", key: "session.filterWeek" },
  { value: "month", key: "session.filterMonth" },
];
const LENGTH_OPTIONS: { value: LengthRange; key: TKey }[] = [
  { value: "any", key: "session.filterAnyLength" },
  { value: "short", key: "session.filterShort" },
  { value: "medium", key: "session.filterMedium" },
  { value: "long", key: "session.filterLong" },
];

type MenuId = "date" | "pair" | "length";

const pairLabel = (key: string) => {
  const [src, tgt] = key.split(">");
  return `${langName(src ?? "")} → ${langName(tgt ?? "")}`;
};

export function HistoryFilterBar({
  value,
  onChange,
  sessions,
  large,
}: {
  value: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
  /** The FULL list (not the filtered one) — the Language menu's source. */
  sessions: readonly FilterableSession[];
  large?: boolean;
}) {
  const { t, dir } = useLocale();
  const [menu, setMenu] = useState<MenuId | null>(null);
  const dateRef = useRef<View>(null);
  const pairRef = useRef<View>(null);
  const lengthRef = useRef<View>(null);
  const pairs = languagePairs(sessions);
  const rtl = dir === "rtl";

  const set = (patch: Partial<HistoryFilters>) => {
    onChange({ ...value, ...patch });
    setMenu(null);
  };
  const toggle = (m: MenuId) => setMenu((cur) => (cur === m ? null : m));

  const dateLabel = t(DATE_OPTIONS.find((o) => o.value === value.date)!.key);
  const lengthLabel = t(LENGTH_OPTIONS.find((o) => o.value === value.length)!.key);
  const pairText = value.pair ? pairLabel(value.pair) : t("session.filterAllLanguages");

  const placement = rtl ? "bottom-end" : "bottom-start";
  const menuProps = { gap: 6, margin: 8, minWidth: large ? 240 : 210, style: styles.menu, placement } as const;

  return (
    <View style={[styles.bar, large && styles.barLarge]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Bleeds the chips' press scale / focus ring past the clip edge.
        style={styles.scroller}
        contentContainerStyle={[styles.row, rtlRow(dir), large && styles.rowLarge]}
      >
      <Chip
        chipRef={dateRef}
        icon="calendar"
        label={dateLabel}
        active={value.date !== "any"}
        open={menu === "date"}
        chevron
        large={large}
        onPress={() => toggle("date")}
      />
      <Chip
        chipRef={pairRef}
        icon="globe"
        label={pairText}
        active={value.pair !== null}
        open={menu === "pair"}
        chevron
        large={large}
        onPress={() => toggle("pair")}
      />
      <Chip
        chipRef={lengthRef}
        icon="clock"
        label={lengthLabel}
        active={value.length !== "any"}
        open={menu === "length"}
        chevron
        large={large}
        onPress={() => toggle("length")}
      />
      <Chip
        icon="sparkles"
        label={t("session.filterSummarized")}
        active={value.summarized}
        large={large}
        onPress={() => onChange({ ...value, summarized: !value.summarized })}
      />
      </ScrollView>

      <AnchoredPopover open={menu === "date"} onClose={() => setMenu(null)} anchorRef={dateRef} {...menuProps}>
        {DATE_OPTIONS.map((o, i) => (
          <MenuItem
            key={o.value}
            label={t(o.key)}
            selected={value.date === o.value}
            first={i === 0}
            last={i === DATE_OPTIONS.length - 1}
            large={large}
            onPress={() => set({ date: o.value })}
          />
        ))}
      </AnchoredPopover>
      <AnchoredPopover open={menu === "pair"} onClose={() => setMenu(null)} anchorRef={pairRef} {...menuProps}>
        {[{ key: null as string | null, count: sessions.length }, ...pairs].map((p, i, all) => (
          <MenuItem
            key={p.key ?? "all"}
            label={p.key ? pairLabel(p.key) : t("session.filterAllLanguages")}
            trailing={String(p.count)}
            selected={value.pair === p.key}
            first={i === 0}
            last={i === all.length - 1}
            large={large}
            onPress={() => set({ pair: p.key })}
          />
        ))}
      </AnchoredPopover>
      <AnchoredPopover open={menu === "length"} onClose={() => setMenu(null)} anchorRef={lengthRef} {...menuProps}>
        {LENGTH_OPTIONS.map((o, i) => (
          <MenuItem
            key={o.value}
            label={t(o.key)}
            selected={value.length === o.value}
            first={i === 0}
            last={i === LENGTH_OPTIONS.length - 1}
            large={large}
            onPress={() => set({ length: o.value })}
          />
        ))}
      </AnchoredPopover>
    </View>
  );
}

/** How many filters are on (the button's badge). */
const activeCount = (f: HistoryFilters) =>
  (f.date !== "any" ? 1 : 0) + (f.pair !== null ? 1 : 0) + (f.length !== "any" ? 1 : 0) + (f.summarized ? 1 : 0);

/**
 * Phone: a 44pt filter button (iOS "line.3.horizontal.decrease" glyph) beside
 * the search. Off → surface; any filter on → accentSoft + accent border, the
 * glyph crossfades to accent and a count badge zooms in (all 200ms). It opens
 * a panel (AnchoredPopover: fade + 4px slide in AND out) that stays open while
 * you pick, so several filters can be combined in one visit.
 */
export function HistoryFilterMenuButton({
  value,
  onChange,
  sessions,
}: {
  value: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
  sessions: readonly FilterableSession[];
}) {
  const { t, dir } = useLocale();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const ref = useRef<View>(null);
  const n = activeCount(value);
  const pairs = languagePairs(sessions);
  const rtl = dir === "rtl";

  const p = useSharedValue(n > 0 || open ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(n > 0 || open ? 1 : 0, COLOR_T);
  }, [n, open, p]);
  const face = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.surface, C.accentSoft]) as string,
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));

  const set = (patch: Partial<HistoryFilters>) => onChange({ ...value, ...patch });

  return (
    <>
      <PressableScale
        ref={ref}
        scaleTo={0.94}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={t("session.filterMenuA11y")}
        accessibilityState={{ expanded: open }}
        accessibilityValue={n > 0 ? { now: n } : undefined}
      >
        <Animated.View style={[styles.menuBtn, face]}>
          <TintIcon name="line.3.horizontal.decrease" size={18} p={p} />
          {n > 0 ? (
            <Animated.View
              entering={reduce ? undefined : TW_ENTER.dialog}
              exiting={reduce ? undefined : TW_EXIT.dialog}
              style={[styles.badge, rtl ? { left: -6 } : { right: -6 }]}
            >
              <Text style={styles.badgeText}>{n}</Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      </PressableScale>

      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        placement={rtl ? "bottom-start" : "bottom-end"}
        gap={8}
        margin={16}
        width={Math.min(width - 32, 420)}
        style={styles.menu}
      >
        <View style={styles.panel}>
          <Section label={t("session.filterDate")}>
            {DATE_OPTIONS.map((o) => (
              <OptionPill
                key={o.value}
                label={t(o.key)}
                selected={value.date === o.value}
                onPress={() => set({ date: o.value })}
              />
            ))}
          </Section>
          <Section label={t("session.filterLanguage")}>
            {[{ key: null as string | null, count: sessions.length }, ...pairs].map((o) => (
              <OptionPill
                key={o.key ?? "all"}
                label={o.key ? pairLabel(o.key) : t("session.filterAllLanguages")}
                trailing={String(o.count)}
                selected={value.pair === o.key}
                onPress={() => set({ pair: o.key })}
              />
            ))}
          </Section>
          <Section label={t("session.filterLength")}>
            {LENGTH_OPTIONS.map((o) => (
              <OptionPill
                key={o.value}
                label={t(o.key)}
                selected={value.length === o.value}
                onPress={() => set({ length: o.value })}
              />
            ))}
          </Section>
        </View>
        <View style={styles.panelDivider} />
        <View style={styles.toggleWrap}>
          <Toggle
            label={t("session.filterSummarized")}
            checked={value.summarized}
            onChange={() => set({ summarized: !value.summarized })}
          />
        </View>
      </AnchoredPopover>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const { dir } = useLocale();
  return (
    <View>
      <Text style={[styles.sectionLabel, rtlText(dir)]}>{label}</Text>
      <View style={[styles.pills, rtlRow(dir)]}>{children}</View>
    </View>
  );
}

/** A selectable option in the phone panel — Chip's on/off crossfade, no icon. */
function OptionPill({
  label,
  trailing,
  selected,
  onPress,
}: {
  label: string;
  trailing?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { dir } = useLocale();
  const p = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(selected ? 1 : 0, COLOR_T);
  }, [selected, p]);
  const face = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.surfaceLight, C.accentSoft]) as string,
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.t2, C.accent]) as string,
  }));
  return (
    <PressableScale
      scaleTo={0.96}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
    >
      <Animated.View style={[styles.pill, rtlRow(dir), face]}>
        <Animated.Text numberOfLines={1} style={[styles.pillText, text]}>
          {label}
        </Animated.Text>
        {trailing ? <Text style={styles.pillCount}>{trailing}</Text> : null}
      </Animated.View>
    </PressableScale>
  );
}

/** Two stacked SF Symbols (off / on tint), crossfaded by `p` (0 → 1). */
function TintIcon({ name, size, p }: { name: SFSymbol; size: number; p: { value: number } }) {
  const on = useAnimatedStyle(() => ({ opacity: p.value }));
  const off = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, off]}>
        <SymbolView name={name} size={size} tintColor={C.t3} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, on]}>
        <SymbolView name={name} size={size} tintColor={C.accent} />
      </Animated.View>
    </View>
  );
}

function Chip({
  chipRef,
  icon,
  label,
  active,
  open = false,
  chevron = false,
  large,
  onPress,
}: {
  chipRef?: React.RefObject<View | null>;
  icon: SFSymbol;
  label: string;
  active: boolean;
  open?: boolean;
  chevron?: boolean;
  large?: boolean;
  onPress: () => void;
}) {
  const { dir } = useLocale();
  const reduce = useReduceMotion();
  const p = useSharedValue(active ? 1 : 0);
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(active ? 1 : 0, COLOR_T);
  }, [active, p]);
  useEffect(() => {
    turn.value = reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { ...COLOR_T, easing: EASE.smooth });
  }, [open, reduce, turn]);

  const face = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.surface, C.accentSoft]) as string,
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.t2, C.accent]) as string,
  }));
  const chev = useAnimatedStyle(() => ({ transform: [{ rotate: `${180 * turn.value}deg` }] }));
  const iconSize = large ? 15 : 13;

  return (
    <Animated.View layout={reduce ? undefined : REFLOW}>
      <PressableScale
        ref={chipRef}
        scaleTo={0.97}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active, expanded: chevron ? open : undefined }}
        accessibilityLabel={label}
      >
        <Animated.View style={[styles.chip, large && styles.chipLarge, rtlRow(dir), face]}>
          <TintIcon name={icon} size={iconSize} p={p} />
          <Animated.Text numberOfLines={1} style={[styles.chipText, large && styles.chipTextLarge, text]}>
            {label}
          </Animated.Text>
          {chevron ? (
            <Animated.View style={chev}>
              <TintIcon name="chevron.down" size={large ? 12 : 10} p={p} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </PressableScale>
    </Animated.View>
  );
}

/**
 * "× Clear filters" — sits beside the History count (fade + zoom in AND out,
 * 150ms) so it never changes the header's height.
 */
export function ClearFiltersLink({
  visible,
  large,
  onPress,
}: {
  visible: boolean;
  large?: boolean;
  onPress: () => void;
}) {
  const { t, dir } = useLocale();
  const reduce = useReduceMotion();
  if (!visible) return null;
  return (
    <Animated.View entering={reduce ? undefined : TW_ENTER.dialog} exiting={reduce ? undefined : TW_EXIT.dialog}>
      <PressableScale
        scaleTo={0.96}
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        pressColors={{ backgroundColor: ["rgba(46,204,113,0)", "rgba(46,204,113,0.1)"], duration: 150 }}
        style={[styles.clear, large && styles.clearLarge, rtlRow(dir)]}
      >
        <SymbolView name="xmark" size={large ? 11 : 9} tintColor={C.accent} weight="bold" />
        <Text style={[styles.clearText, large && styles.clearTextLarge]}>{t("session.filterClear")}</Text>
      </PressableScale>
    </Animated.View>
  );
}

function MenuItem({
  label,
  trailing,
  selected,
  first,
  last,
  large,
  onPress,
}: {
  label: string;
  trailing?: string;
  selected: boolean;
  first: boolean;
  last: boolean;
  large?: boolean;
  onPress: () => void;
}): ReactNode {
  const { dir } = useLocale();
  return (
    <PressableScale
      scaleTo={1}
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      pressColors={{ backgroundColor: ["rgba(0,0,0,0)", "rgba(0,0,0,0.2)"], duration: 150 }}
      style={[
        styles.item,
        large && styles.itemLarge,
        rtlRow(dir),
        first && styles.itemFirst,
        last && styles.itemLast,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.itemText, large && styles.itemTextLarge, { color: selected ? C.accent : C.t2 }, rtlText(dir)]}
      >
        {label}
      </Text>
      {trailing ? <Text style={[styles.trailing, large && styles.trailingLarge]}>{trailing}</Text> : null}
      <View style={styles.check}>
        {selected ? <SymbolView name="checkmark" size={large ? 14 : 12} tintColor={C.accent} weight="bold" /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  bar: { marginTop: 12, marginHorizontal: -4 },
  barLarge: { marginTop: 14 },
  scroller: { overflow: "visible" },
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 4, flexGrow: 1 },
  rowLarge: { gap: 10 },
  center: { alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipLarge: { height: 40, paddingHorizontal: 15, gap: 8, borderRadius: 14 },
  // The negative vertical margin cancels the padding in layout: the press
  // highlight keeps its room, but the link adds no height to the title row
  // (so the header never moves when it fades in).
  clear: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginVertical: -4,
    borderRadius: 8,
  },
  clearLarge: { gap: 6, paddingHorizontal: 10, paddingVertical: 5, marginVertical: -5 },
  clearText: { color: C.accent, fontSize: 12, fontWeight: "600" },
  clearTextLarge: { fontSize: 14 },
  chipText: { fontSize: 13, fontWeight: "600", maxWidth: 200 },
  chipTextLarge: { fontSize: 15, maxWidth: 260 },
  menu: {
    borderRadius: 12,
    backgroundColor: C.surface,
    borderColor: C.borderLight,
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.5)",
  },
  item: { alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  itemLarge: { paddingHorizontal: 18, paddingVertical: 14 },
  itemFirst: { borderTopLeftRadius: 11, borderTopRightRadius: 11 },
  itemLast: { borderBottomLeftRadius: 11, borderBottomRightRadius: 11 },
  itemText: { flex: 1, fontSize: 14, fontWeight: "600" },
  itemTextLarge: { fontSize: 16 },
  trailing: { color: C.t4, fontSize: 12, fontVariant: ["tabular-nums"] },
  trailingLarge: { fontSize: 14 },
  check: { width: 16, alignItems: "center" },

  // Phone filter button + panel
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#0A0F1C", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  panel: { padding: 16, gap: 16 },
  sectionLabel: {
    color: C.t3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.88,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: "600" },
  pillCount: { color: C.t4, fontSize: 12, fontVariant: ["tabular-nums"] },
  panelDivider: { borderTopWidth: 1, borderTopColor: C.border },
  toggleWrap: { borderBottomLeftRadius: 11, borderBottomRightRadius: 11, overflow: "hidden" },
});
