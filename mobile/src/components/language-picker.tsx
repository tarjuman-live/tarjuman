/**
 * LanguagePicker — port of src/components/recording/language-selector.tsx +
 * language-picker-sheet.tsx.
 *
 * TILES ("Listening to" / "Translate to")
 *   - Green outline-glow while pressed (web pointerenter/leave, which fire on a
 *     tap too): border borderLight → accent + `0 0 0 1px accent, 0 8px 28px
 *     accent@22%`, 220ms CSS ease (PressableScale `glow` = TILE_GLOW, spread
 *     widened to 2px because the native layer sits inside the border; no press scale — the
 *     web tile has none). Press-only: the web LangButton's lit state is
 *     `hover` alone (no `|| open` term), so it does NOT stay lit while the
 *     sheet is open.
 *   - Value crossover: the old name leaves toward the other tile (opacity 0,
 *     translateX slide·14, 150ms ease-in), the text swaps after a 150ms timer,
 *     the new name arrives from that side (opacity 260ms ease-out, translateX
 *     260ms bezier(.22,1,.36,1)). Source slide +1, target −1 → on a swap the
 *     names cross. A second swap mid-flight settles back. Reduce Motion:
 *     instant (web: transition none, 0ms timer).
 * SWAP BUTTON (40×40, rounded 16)
 *   - Warm while pressed: bg accentSoft → amberSoft, border accent@30 →
 *     amber@30, icon accent → amber, glow → 0 0 16px amber@55 (300ms ease),
 *     scale 1 → 1.06 (200ms ease).
 *   - ONE full turn per swap tap (+360°, accumulating), 750ms soft ease-out
 *     (EASE.smooth, no overshoot). The web's extra hover "wind" (0→360° on
 *     pointerenter, unwound on leave) is deliberately dropped on touch: a tap
 *     fired wind + unwind + swap turn together and the icon whipped round
 *     twice in ~0.5s (user: "rotating too fast", 2026-10-01). Reduce Motion:
 *     colours snap, no scale, no rotation.
 * SHEET (vaul drawer → foundation GlassSheet: 500ms bezier(.32,.72,0,1) in/out,
 *   drag-to-dismiss). Drag can start on the grabber, the title block and the
 *   list (at its top); only the search row is no-drag, like the web's
 *   `data-vaul-no-drag` wrapper. The list is auto-animated on the web
 *   (useAutoAnimate {200, bezier(.22,1,.36,1)}), whose built-ins are:
 *     add    → opacity 0 / scale .98 held to 50%, then → 1, 300ms ease-in
 *     remove → opacity 1 / scale 1 → 0 / .98, 200ms ease-out
 *     remain → FLIP 200ms bezier(.22,1,.36,1)
 *   Initial rows don't animate (LayoutAnimationConfig skipEntering, re-keyed
 *   per open, around a single host View so filter removals still animate).
 *   "No languages found" is part of the same list. Auto-animate disables
 *   itself under reduced motion → so do we.
 *   Row press (web hover): bg transparent → surfaceLight, 150ms tw. The clear
 *   (×) button dims to .7 while pressed, instantly (web hover:opacity-70).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  Keyframe,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LANGUAGES } from "@shared/constants";
import { langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { EASE, useReduceMotion } from "~/lib/motion";
import { useLocale } from "~/i18n";
import { GlassSheet, GlassSheetScrollView } from "./glass-sheet";
import { PressableScale } from "./motion/pressable-scale";

interface Props {
  source: string;
  target: string;
  onChange: (next: { source: string; target: string }) => void;
  disabled?: boolean;
}

const CSS_EASE_IN = Easing.bezier(0.42, 0, 1, 1);
const CSS_EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const VALUE_OUT_MS = 150;

export function LanguagePicker({ source, target, onChange, disabled }: Props) {
  const { t, dir } = useLocale();
  const [open, setOpen] = useState<null | "source" | "target">(null);
  // Keeps the sheet's title/selection stable while it slides out.
  const [sheetType, setSheetType] = useState<"source" | "target">("source");
  const rtl = dir === "rtl";

  const openSheet = (type: "source" | "target") => {
    setSheetType(type);
    setOpen(type);
  };

  return (
    <View style={[styles.card, { flexDirection: rtl ? "row-reverse" : "row" }]}>
      <LangTile
        label={t("record.listeningTo")}
        value={langName(source)}
        slide={rtl ? -1 : 1}
        disabled={disabled}
        onPress={() => openSheet("source")}
      />
      <SwapButton
        disabled={disabled}
        label={t("record.swapLanguages")}
        onSwap={() => {
          void Haptics.selectionAsync();
          onChange({ source: target, target: source });
        }}
      />
      <LangTile
        label={t("record.translateTo")}
        value={langName(target)}
        slide={rtl ? 1 : -1}
        disabled={disabled}
        onPress={() => openSheet("target")}
      />

      <LanguageSheet
        open={open !== null}
        type={sheetType}
        selected={sheetType === "source" ? source : target}
        onClose={() => setOpen(null)}
        onSelect={(code) => {
          // Picking the other side's language swaps instead (web parity).
          if (sheetType === "source") {
            onChange(code === target ? { source: code, target: source } : { source: code, target });
          } else {
            onChange(code === source ? { source: target, target: code } : { source, target: code });
          }
          setOpen(null);
        }}
      />
    </View>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

function LangTile({
  label,
  value,
  slide,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  slide: 1 | -1;
  disabled?: boolean;
  onPress: () => void;
}) {
  const reduce = useReduceMotion();
  const { dir } = useLocale();
  const [shown, setShown] = useState(value);
  const o = useSharedValue(1);
  const tx = useSharedValue(0);

  useEffect(() => {
    if (value === shown) {
      // Arrive (or settle back after a mid-flight revert).
      if (reduce) {
        o.value = 1;
        tx.value = 0;
      } else {
        o.value = withTiming(1, { duration: 260, easing: CSS_EASE_OUT, reduceMotion: ReduceMotion.Never });
        tx.value = withTiming(0, { duration: 260, easing: EASE.smooth, reduceMotion: ReduceMotion.Never });
      }
      return;
    }
    if (reduce) {
      o.value = 1;
      tx.value = 0;
    } else {
      const out = { duration: VALUE_OUT_MS, easing: CSS_EASE_IN, reduceMotion: ReduceMotion.Never };
      o.value = withTiming(0, out);
      tx.value = withTiming(slide * 14, out);
    }
    const id = setTimeout(() => setShown(value), reduce ? 0 : VALUE_OUT_MS);
    return () => clearTimeout(id);
  }, [value, shown, reduce, slide, o, tx]);

  const valueStyle = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateX: tx.value }] }));
  const align = dir === "rtl" ? ({ textAlign: "right", writingDirection: "rtl" } as const) : null;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      disabledOpacity={1}
      scaleTo={1}
      glow={TILE_GLOW}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={styles.tile}
    >
      <Text style={[styles.tileLabel, align]}>{label}</Text>
      <Animated.Text style={[styles.tileValue, align, valueStyle]} numberOfLines={1}>
        {shown}
      </Animated.Text>
    </PressableScale>
  );
}

/**
 * The web ring is the tile's 1px accent BORDER plus a separate `0 0 0 1px`
 * shadow drawn OUTSIDE it = 2px of green. PressableScale's glow layer is
 * absoluteFill, i.e. it starts at the padding box (inside the 1px border), so
 * the spread is 2px (1 covers the border, 1 lands outside) and the halo gets a
 * 1px spread so it too starts at the border-box edge, like the web's.
 */
const TILE_GLOW = { shadow: "0 0 0 2px #2ECC71, 0 8px 28px 1px rgba(46, 204, 113, 0.22)" } as const;

// ─── Swap ─────────────────────────────────────────────────────────────────────

function SwapButton({ onSwap, disabled, label }: { onSwap: () => void; disabled?: boolean; label: string }) {
  const reduce = useReduceMotion();
  const warm = useSharedValue(0);
  const sc = useSharedValue(1);
  const inner = useSharedValue(0);
  const spinRef = useRef(0);

  const setWarm = (on: boolean) => {
    if (reduce) {
      warm.value = on ? 1 : 0;
      sc.value = 1;
      return;
    }
    const nv = { reduceMotion: ReduceMotion.Never };
    warm.value = withTiming(on ? 1 : 0, { duration: 300, easing: EASE.css, ...nv });
    sc.value = withTiming(on ? 1.06 : 1, { duration: 200, easing: EASE.css, ...nv });
  };

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(warm.value, [0, 1], [C.accentSoft, C.amberSoft]),
    borderColor: interpolateColor(warm.value, [0, 1], [`${C.accent}30`, `${C.amber}30`]),
    transform: [{ scale: sc.value }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: warm.value }));
  const amberIcon = useAnimatedStyle(() => ({ opacity: warm.value }));
  const greenIcon = useAnimatedStyle(() => ({ opacity: 1 - warm.value }));
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${inner.value}deg` }] }));

  return (
    <Pressable
      disabled={disabled}
      hitSlop={6}
      onPressIn={() => setWarm(true)}
      onPressOut={() => setWarm(false)}
      onPress={() => {
        if (!reduce) {
          spinRef.current += 360;
          inner.value = withTiming(spinRef.current, {
            duration: 750,
            easing: EASE.smooth,
            reduceMotion: ReduceMotion.Never,
          });
        }
        onSwap();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.swap, box]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.swapGlow, glow]} />
        <Animated.View style={spin}>
          <View style={styles.swapIcon}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.center, greenIcon]}>
              <SymbolView name="arrow.left.arrow.right" tintColor={C.accent} size={16} weight="semibold" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.center, amberIcon]}>
              <SymbolView name="arrow.left.arrow.right" tintColor={C.amber} size={16} weight="semibold" />
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

// auto-animate 0.10 built-in keyframes (the custom easing only drives the FLIP).
//
// add: `el.animate([{s.98,o0}, {s.98,o0, offset .5}, {s1,o1}], {duration 300,
// easing: "ease-in"})` — the WAAPI `easing` option is the EFFECT timing
// function: it warps the whole 300ms timeline, and the .5 offset sits in that
// eased-progress space. So the row stays invisible until ease-in reaches .5
// (t ≈ .6575 → ~197ms), then fades/scales in over the last ~103ms along the
// remaining slice of the same ease-in curve. Reanimated keyframe easings are
// per segment, so: a linear hold to 65.75%, then a tail easing that replays
// ease-in's [.6575, 1] slice renormalised to 0..1.
const EASE_IN_FN = Easing.bezierFn(0.42, 0, 1, 1);
/** Solve ease-in(t) = .5 (≈ .6575) — where the .5 offset lands in time. */
const ADD_HOLD = (() => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (EASE_IN_FN(m) < 0.5) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
})();
const ADD_TAIL = (s: number) => {
  "worklet";
  return (EASE_IN_FN(ADD_HOLD + s * (1 - ADD_HOLD)) - 0.5) / 0.5;
};
const ROW_ADD = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.98 }] },
  [ADD_HOLD * 100]: { opacity: 0, transform: [{ scale: 0.98 }], easing: Easing.linear },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: ADD_TAIL },
}).duration(300);
const ROW_REMOVE = new Keyframe({
  0: { opacity: 1, transform: [{ scale: 1 }] },
  100: { opacity: 0, transform: [{ scale: 0.98 }], easing: CSS_EASE_OUT },
}).duration(200);
const ROW_MOVE = LinearTransition.duration(200).easing(EASE.smooth);

/** Strip diacritics so "francais" matches "Français" (web normalize()). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function LanguageSheet({
  open,
  type,
  selected,
  onClose,
  onSelect,
}: {
  open: boolean;
  type: "source" | "target";
  selected: string;
  onClose: () => void;
  onSelect: (code: string) => void;
}) {
  const { t, dir } = useLocale();
  const reduce = useReduceMotion();
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);
  const rtl = dir === "rtl";
  // Re-key the list's LayoutAnimationConfig on every open (derived during
  // render, no extra commit) so rows present when the sheet opens never
  // animate — auto-animate only animates changes after mount.
  const [openCount, setOpenCount] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpenCount((n) => n + 1);
  }

  const items = useMemo(() => {
    const q = normalize(query.trim());
    return q
      ? LANGUAGES.filter(
          (l) => normalize(l.name).includes(q) || normalize(l.native).includes(q) || l.code.toLowerCase().includes(q)
        )
      : LANGUAGES;
  }, [query]);

  const anim = !reduce;
  const align = rtl ? ({ textAlign: "right", writingDirection: "rtl" } as const) : null;

  // Only the search row is vaul `data-vaul-no-drag` on the web; the title
  // block sits in the draggable DrawerContent. GlassSheet's `header` slot is
  // no-drag as a WHOLE, so the title + search live in `children` (inside the
  // sheet's drag pan) and just the search row gets a local blocker pan. It
  // activates at 4px — before the sheet pan's 6px — and, being the deeper
  // non-simultaneous handler, cancels the sheet drag (same trick GlassSheet's
  // own header slot uses, minus the requireExternalGestureToFail wiring we
  // can't reach from here).
  const noDrag = useMemo(() => Gesture.Pan().activeOffsetY([-4, 4]), []);

  const header = (
    <>
      <View style={styles.sheetHead}>
        <Text style={[styles.sheetTitle, align]}>
          {type === "source" ? t("record.sourceLanguage") : t("record.targetLanguage")}
        </Text>
        <Text style={[styles.sheetSub, align]}>
          {type === "source" ? t("record.sourceLanguageSub") : t("record.targetLanguageSub")}
        </Text>
      </View>
      <GestureDetector gesture={noDrag}>
        <View style={styles.searchWrap}>
          <View style={[styles.search, { flexDirection: rtl ? "row-reverse" : "row" }]}>
            <SymbolView name="magnifyingglass" tintColor={C.t3} size={15} />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, align]}
              placeholder={t("record.searchLanguages")}
              placeholderTextColor={C.t3}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query ? (
              <Pressable
                onPress={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("record.clearSearch")}
                style={({ pressed }) => [styles.clear, pressed && { opacity: 0.7 }]}
              >
                <SymbolView name="xmark" tintColor={C.t3} size={13} weight="semibold" />
              </Pressable>
            ) : null}
          </View>
        </View>
      </GestureDetector>
    </>
  );

  return (
    <GlassSheet
      open={open}
      onClose={onClose}
      onClosed={() => setQuery("")}
      contentStyle={styles.sheetContent}
    >
      {header}
      <GlassSheetScrollView contentContainerStyle={styles.list} keyboardDismissMode="on-drag">
        {/* ONE host View child: with several children and skipExiting,
            LayoutAnimationConfig wraps EACH row in its own skipExiting config,
            which kills every filtered-out row's ROW_REMOVE and remounts the
            survivor when the list crosses 1 ⇄ 2+ rows. With a single host
            child, skipExiting only covers the re-key on reopen (the previous
            open's rows leave without exit ghosts); rows removed by the filter
            still play their 200ms exit, like web auto-animate. */}
        <LayoutAnimationConfig key={openCount} skipEntering skipExiting>
          <View>
          {items.length === 0 ? (
            <Animated.View
              key="empty"
              entering={anim ? ROW_ADD : undefined}
              exiting={anim ? ROW_REMOVE : undefined}
              style={styles.empty}
            >
              <Text style={styles.emptyText}>{t("record.noLanguages")}</Text>
            </Animated.View>
          ) : (
            items.map((lang) => (
              <Animated.View
                key={lang.code}
                entering={anim ? ROW_ADD : undefined}
                exiting={anim ? ROW_REMOVE : undefined}
                layout={anim ? ROW_MOVE : undefined}
              >
                <LangRow
                  name={lang.name}
                  native={lang.native}
                  nativeRtl={lang.rtl}
                  selected={selected === lang.code}
                  rtl={rtl}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    onSelect(lang.code);
                  }}
                />
              </Animated.View>
            ))
          )}
          </View>
        </LayoutAnimationConfig>
      </GlassSheetScrollView>
    </GlassSheet>
  );
}

const ROW_T = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
const SURFACE_LIGHT_CLEAR = "rgba(21,29,48,0)";

function LangRow({
  name,
  native,
  nativeRtl,
  selected,
  rtl,
  onPress,
}: {
  name: string;
  native: string;
  nativeRtl: boolean;
  selected: boolean;
  rtl: boolean;
  onPress: () => void;
}) {
  const p = useSharedValue(0);
  // Web row `transition-colors` (150ms tw): when a pick flips isSelected, the
  // new row tweens (hovered surfaceLight / transparent) → accentSoft and the
  // old row accentSoft → transparent while the drawer slides out. Mounts at
  // rest (no tween on open). The name colour / checkmark swap instantly (web).
  const sel = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    sel.value = withTiming(selected ? 1 : 0, ROW_T);
  }, [selected, sel]);
  const bg = useAnimatedStyle(() => {
    const base = interpolateColor(p.value, [0, 1], [SURFACE_LIGHT_CLEAR, C.surfaceLight]) as string;
    return { backgroundColor: interpolateColor(sel.value, [0, 1], [base, C.accentSoft]) };
  });
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (!selected) p.value = withTiming(1, ROW_T);
      }}
      onPressOut={() => {
        p.value = withTiming(0, ROW_T);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Animated.View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }, bg]}>
        <View style={[styles.rowNames, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <Text style={[styles.rowName, selected && { color: C.accent }]}>{name}</Text>
          <Text style={[styles.rowNative, { writingDirection: nativeRtl ? "rtl" : "ltr" }]}>{native}</Text>
        </View>
        {selected ? (
          <View style={styles.check}>
            <SymbolView name="checkmark" tintColor="#fff" size={11} weight="bold" />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: 12,
    padding: 24,
    borderRadius: 24,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tile: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  tileLabel: {
    color: C.t3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.88,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  tileValue: { color: C.w, fontSize: 15, fontWeight: "700" },
  swap: {
    width: 40,
    height: 40,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  swapGlow: { borderRadius: 16, boxShadow: "0 0 16px rgba(245,158,11,0.33)" },
  swapIcon: { width: 20, height: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  sheetContent: { paddingTop: 8 },
  sheetHead: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sheetTitle: { color: C.w, fontSize: 16, fontWeight: "700" },
  sheetSub: { color: C.t3, fontSize: 13, marginTop: 2 },
  searchWrap: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  search: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(10, 16, 30, 0.7)",
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  searchInput: { flex: 1, color: C.w, fontSize: 14, paddingVertical: 0 },
  clear: { padding: 2, borderRadius: 4 },
  list: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 12 },
  empty: { paddingVertical: 32, alignItems: "center" },
  emptyText: { color: C.t3, fontSize: 14 },
  row: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
  },
  rowNames: { flex: 1, alignItems: "center", gap: 12 },
  rowName: { color: C.w, fontSize: 14, fontWeight: "600" },
  rowNative: { color: C.t3, fontSize: 13, flexShrink: 1 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
