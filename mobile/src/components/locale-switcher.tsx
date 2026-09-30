/**
 * LocaleSwitcher — the app-language picker, ported from
 * src/components/shared/locale-switcher.tsx. Contract (CONTRACTS.md):
 *   variant "pill" = the web `compact` tile (36×36, surfaceLight, the locale
 *                    code) — welcome nav / record header;
 *   variant "row"  = the non-compact trigger (h36 px12, surface, globe +
 *                    native name + chevron) — the Settings "App language" card.
 *
 * Motion (web → native):
 *   - Trigger lit (hover || open → pressed || open): border borderLight →
 *     accent and box-shadow → `0 0 0 1px accent, 0 0 16px rgba(46,204,113,.4)`,
 *     200ms CSS ease. The glow layer is local (not PressableScale's): it sits
 *     on the BORDER box (inset −1, outer radius 12) so the 1px ring lands
 *     OUTSIDE the 1px accent border — 2px of lit outline, like the web — not
 *     on top of it. The code/icon colour t2 → accent
 *     is INSTANT on the web (no transition on that span) — same here.
 *   - Chevron (row): rotate 0 → 180deg, transition-transform duration-200
 *     (Tailwind curve), not gated by reduced motion (a plain CSS transition).
 *   - Panel: `animate-in fade-in slide-in-from-top-1 duration-200` and, kept
 *     mounted, `animate-out fade-out slide-out-to-top-1` (−4px; +4px when it
 *     opens upward — the sidebar's dropUp) — 200ms CSS ease, IN and OUT.
 *     Outside tap closes (web: outside mousedown / Escape). tw-animate classes
 *     are NOT motion-gated on the web, so the 4px slide also plays under
 *     Reduce Motion (the shared AnchoredPopover drops it — hence the local
 *     LocalePanel below).
 *   - LocalePanel (local, not AnchoredPopover): the web panel never jumps
 *     sides (`end-0 mt-1.5`, always below). On a phone it may not fit below,
 *     so the side is decided ONCE when it opens (below if the 60vh panel fits
 *     or below has more room, else above) and held until it closes — typing in
 *     the search field shrinks the list but never flips the panel. Its height
 *     is capped to the room on that side, and while the keyboard is up the
 *     panel is kept clear of it (the cap/offset glide with the keyboard's own
 *     duration).
 *   - Option rows: `transition-all duration-150` — hover (→ press) lights the
 *     house outline-glow: border transparent → accent, bg → accent-soft,
 *     shadow → 0 0 18px rgba(46,204,113,.4). The selected row rests on the
 *     softer glow (0 0 14px rgba(46,204,113,.28)) + accent text + check, and
 *     pressing it bumps the glow to 18px/.4.
 *
 * Native deviations (documented):
 *   - The search field is NOT auto-focused: on a phone that raises the
 *     keyboard over most of the 31-row list. Tap it to search; Return picks
 *     the first match (web: Enter).
 *   - The query resets when the panel OPENS (web resets on close, which made
 *     the list jump back to all 31 rows during the exit fade).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type KeyboardEvent,
} from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { rtlRow, rtlText, UI_LOCALES, useLocale, type LocaleCode } from "~/i18n";
import { usePresenceProgress } from "./motion/presence";

export interface LocaleSwitcherProps {
  variant?: "pill" | "row";
  /**
   * Web `dropUp` (sidebar-rail footer): the panel always opens UPWARD and is
   * START-aligned to the trigger (`start-0 bottom-full mb-1.5`) — left edge on
   * the trigger's left edge in LTR, right edge on its right edge in RTL.
   * Default (false) = web `end-0 mt-1.5`: end-aligned, side picked at open.
   */
  dropUp?: boolean;
}

// Alphabetical by English label — a predictable A→Z (web SORTED_LOCALES).
const SORTED_LOCALES = [...UI_LOCALES].sort((a, b) => a.label.localeCompare(b.label));

/** Web trigger glow: `0 0 0 1px accent, 0 0 16px rgba(46,204,113,0.4)`, 200ms ease. */
const TRIGGER_SHADOW = `0 0 0 1px ${C.accent}, 0 0 16px rgba(46, 204, 113, 0.4)`;
const TRIGGER_T = { duration: 200, easing: EASE.css, reduceMotion: ReduceMotion.Never };
const TRIGGER_RADIUS = 12;
const TRIGGER_BORDER = 1;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** transition-transform duration-200 (Tailwind curve). */
const CHEVRON_T = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
/** transition-all duration-150 (Tailwind curve). */
const ROW_T = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

// ─── Sidebar-rail header suppression ────────────────────────────────────────
//
// Web record/page.tsx hides its per-page header at lg (`lg:hidden`) because
// "the sidebar carries brand + language + account". On native the tab layout
// provides `active` when the ≥1024pt SidebarRail is up, and the rail wraps its
// own footer in <RailSlot>. A header-style LocaleSwitcher (pill) or
// AccountMenu rendered OUTSIDE the rail while it is up renders nothing, so an
// iPad-width window never shows two locale pills / two avatar menus. Screens
// can read useRailLayout().railActive to hide the rest of their header too.

interface RailLayout {
  /** The ≥lg SidebarRail is currently the tab bar. */
  railActive: boolean;
  /** This subtree IS the rail (its footer). */
  inRail: boolean;
}
const RailLayoutContext = createContext<RailLayout>({ railActive: false, inRail: false });

export function RailLayoutProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ railActive: active, inRail: false }), [active]);
  return <RailLayoutContext.Provider value={value}>{children}</RailLayoutContext.Provider>;
}

export function RailSlot({ children }: { children: ReactNode }) {
  return (
    <RailLayoutContext.Provider value={{ railActive: true, inRail: true }}>{children}</RailLayoutContext.Provider>
  );
}

export function useRailLayout(): RailLayout {
  return useContext(RailLayoutContext);
}

/** True when a header-placed control duplicates the rail's footer copy. */
export function useHiddenByRail(): boolean {
  const { railActive, inRail } = useContext(RailLayoutContext);
  return railActive && !inRail;
}

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  // Only the header pill duplicates the rail; Settings' row variant stays.
  const hidden = useHiddenByRail() && (props.variant ?? "pill") === "pill";
  if (hidden) return null;
  return <LocaleSwitcherImpl {...props} />;
}

function LocaleSwitcherImpl({ variant = "pill", dropUp = false }: LocaleSwitcherProps) {
  const { locale, setLocale, t, dir } = useLocale();
  const [open, setOpen] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<View>(null);
  const compact = variant === "pill";
  const lit = pressing || open;
  const current = UI_LOCALES.find((l) => l.code === locale);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? SORTED_LOCALES.filter((l) => `${l.native} ${l.label} ${l.code}`.toLowerCase().includes(q))
        : SORTED_LOCALES,
    [q]
  );

  // Chevron: rotate-180 while open.
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withTiming(open ? 180 : 0, CHEVRON_T);
  }, [open, rot]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));

  // Trigger lit: border colour + glow layer, 200ms CSS ease, in and out.
  const litV = useSharedValue(0);
  useEffect(() => {
    litV.value = withTiming(lit ? 1 : 0, TRIGGER_T);
  }, [lit, litV]);
  const triggerBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(litV.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));
  const triggerGlow = useAnimatedStyle(() => ({ opacity: litV.value }));

  const pick = (code: LocaleCode) => {
    void Haptics.selectionAsync().catch(() => {});
    setLocale(code);
    setOpen(false);
  };

  const toggle = () => {
    if (!open) setQuery(""); // fresh search each time it opens
    setOpen(!open);
  };

  const iconColor = lit ? C.accent : C.t2;

  return (
    <>
      <AnimatedPressable
        ref={trigger}
        onPress={toggle}
        onPressIn={() => setPressing(true)}
        onPressOut={() => setPressing(false)}
        accessibilityRole="button"
        accessibilityLabel={t("settings.appLanguage")}
        accessibilityState={{ expanded: open }}
        style={[
          styles.trigger,
          compact ? styles.triggerCompact : [styles.triggerRow, rtlRow(dir)],
          { backgroundColor: compact ? C.surfaceLight : C.surface },
          triggerBorder,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.triggerGlow, triggerGlow]} />
        {compact ? (
          <Text style={[styles.code, { color: iconColor }]}>{locale.toUpperCase()}</Text>
        ) : (
          <>
            <SymbolView name="globe" size={16} tintColor={iconColor} />
            <Text style={styles.native}>{current?.native ?? locale}</Text>
            <Animated.View style={chevron}>
              <SymbolView name="chevron.down" size={11} weight="bold" tintColor={C.w} />
            </Animated.View>
          </>
        )}
      </AnimatedPressable>

      <LocalePanel
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        // dropUp = web `start-0` (start edge = left in LTR, right in RTL);
        // otherwise web `end-0` (right in LTR, left in RTL).
        alignEnd={dropUp ? dir === "rtl" : dir !== "rtl"}
        forceTop={dropUp}
        closeLabel={t("foundation.close")}
      >
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("settingsAuthNav.searchLanguages")}
            placeholderTextColor={C.t4}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => {
              const first = filtered[0];
              if (first) pick(first.code);
            }}
            style={[styles.search, rtlText(dir)]}
            accessibilityLabel={t("settingsAuthNav.searchLanguages")}
          />
        </View>
        {filtered.length === 0 ? (
          <Text style={[styles.empty, rtlText(dir)]}>{t("settingsAuthNav.noLanguages")}</Text>
        ) : null}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          accessibilityRole="list"
        >
          {filtered.map((l) => (
            <LocaleOption
              key={l.code}
              native={l.native}
              label={l.label}
              selected={l.code === locale}
              dir={dir}
              onPress={() => pick(l.code)}
            />
          ))}
        </ScrollView>
      </LocalePanel>
    </>
  );
}

// ─── LocalePanel ─────────────────────────────────────────────────────────────

/** Panel enter/exit: 200ms CSS ease (tw-animate `duration-200`), never gated. */
const PANEL_T = { duration: 200, easing: EASE.css };
/** Web `mt-1.5` / `mb-1.5`. */
const PANEL_GAP = 6;
/** Keep this far inside the window / safe-area edges. */
const PANEL_MARGIN = 8;
/** Web `min-w-[240px]`. */
const PANEL_MIN_W = 240;

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  side: "bottom" | "top";
}

/**
 * The web's keep-mounted panel (`visible` state + 200ms timer): fade + 4px
 * slide in AND out, hosted in a transparent Modal above the tab bar. The side
 * is locked at open (see header); the height cap and keyboard clearance are
 * driven on the UI thread so they glide with the keyboard.
 */
function LocalePanel({
  open,
  onClose,
  anchorRef,
  alignEnd,
  forceTop = false,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<View | null>;
  alignEnd: boolean;
  /** Web dropUp: always `bottom-full` — never picks the below side. */
  forceTop?: boolean;
  closeLabel: string;
  children: ReactNode;
}) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [placed, setPlaced] = useState<Placed | null>(null);
  const { mounted, progress } = usePresenceProgress(open, { enter: PANEL_T, exit: PANEL_T });

  // Keyboard top edge in window coords (win.height = no keyboard).
  const kbTop = useSharedValue(win.height);
  useEffect(() => {
    const move = (to: number, e?: KeyboardEvent) => {
      kbTop.value = withTiming(to, {
        duration: e?.duration && e.duration > 0 ? e.duration : 250,
        easing: EASE.tw,
        reduceMotion: ReduceMotion.Never,
      });
    };
    const show = Keyboard.addListener("keyboardWillShow", (e) => move(e.endCoordinates.screenY, e));
    const change = Keyboard.addListener("keyboardWillChangeFrame", (e) => move(e.endCoordinates.screenY, e));
    const hide = Keyboard.addListener("keyboardWillHide", (e) => move(win.height, e));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, [kbTop, win.height]);

  // Measure + pick the side ONCE per open; held through typing and the exit.
  useEffect(() => {
    if (!open) return;
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      const cap = win.height * 0.6; // web max-h-[60vh]
      const below = win.height - insets.bottom - (y + h) - PANEL_GAP - PANEL_MARGIN;
      const above = y - insets.top - PANEL_GAP - PANEL_MARGIN;
      const side = forceTop ? "top" : below >= cap || below >= above ? "bottom" : "top";
      setPlaced({ x, y, w, h, side });
    });
  }, [open, anchorRef, win.height, insets.top, insets.bottom, forceTop]);

  // Forget the old anchor once fully closed, so a re-open never flashes at a
  // stale position (e.g. after the settings list scrolled).
  useEffect(() => {
    if (!mounted) setPlaced(null);
  }, [mounted]);

  const cap = win.height * 0.6;
  const side = placed?.side ?? "bottom";
  const dy = side === "top" ? 4 : -4;
  const winH = win.height;
  const topEdge = insets.top + PANEL_MARGIN;
  const bottomEdge = insets.bottom + PANEL_MARGIN;
  const anchorTop = placed?.y ?? 0;
  const anchorBottom = placed ? placed.y + placed.h : 0;

  const animated = useAnimatedStyle(() => {
    const kb = Math.min(kbTop.value, winH);
    const keyboardUp = kb < winH - 1;
    if (side === "bottom") {
      const floor = keyboardUp ? kb - PANEL_MARGIN : winH - bottomEdge;
      // If the keyboard leaves too little room under the trigger, the panel
      // rides up with it (over the trigger) instead of hiding the results.
      const minRoom = Math.min(cap, 220);
      let top = anchorBottom + PANEL_GAP;
      if (floor - top < minRoom) top = Math.max(topEdge, floor - minRoom);
      return {
        opacity: progress.value,
        top,
        maxHeight: Math.max(96, Math.min(cap, floor - top)),
        transform: [{ translateY: dy * (1 - progress.value) }],
      };
    }
    // Opens upward: sit above the trigger, or above the keyboard if it covers it.
    const edge = Math.min(anchorTop - PANEL_GAP, keyboardUp ? kb - PANEL_MARGIN : winH);
    return {
      opacity: progress.value,
      bottom: winH - edge,
      maxHeight: Math.max(96, Math.min(cap, edge - topEdge)),
      transform: [{ translateY: dy * (1 - progress.value) }],
    };
  });

  const horizontal = (() => {
    if (!placed) return null;
    const maxOffset = win.width - PANEL_MARGIN - PANEL_MIN_W;
    return alignEnd
      ? { right: Math.min(maxOffset, Math.max(PANEL_MARGIN, win.width - (placed.x + placed.w))) }
      : { left: Math.min(maxOffset, Math.max(PANEL_MARGIN, placed.x)) };
  })();

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
      />
      {placed && horizontal ? (
        <Animated.View style={[styles.panel, horizontal, animated]}>
          {children}
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const REST_GLOW = "0 0 14px rgba(46, 204, 113, 0.28)";
const HOT_GLOW = "0 0 18px rgba(46, 204, 113, 0.4)";

function LocaleOption({
  native,
  label,
  selected,
  dir,
  onPress,
}: {
  native: string;
  label: string;
  selected: boolean;
  dir: "ltr" | "rtl";
  onPress: () => void;
}) {
  const p = useSharedValue(0);
  const restBorder = selected ? C.accent : "rgba(46, 204, 113, 0)";
  const restBg = selected ? C.accentSoft : "rgba(46, 204, 113, 0)";

  const box = useAnimatedStyle(() => ({
    borderColor: interpolateColor(p.value, [0, 1], [restBorder, C.accent]) as string,
    backgroundColor: interpolateColor(p.value, [0, 1], [restBg, C.accentSoft]) as string,
  }));
  // Two static-shadow layers cross-faded (box-shadow itself isn't animatable
  // natively): the selected row's resting 14px/.28 glow → the 18px/.4 hover glow.
  const rest = useAnimatedStyle(() => ({ opacity: selected ? 1 - p.value : 0 }));
  const hot = useAnimatedStyle(() => ({ opacity: p.value }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        p.value = withTiming(1, ROW_T);
      }}
      onPressOut={() => {
        p.value = withTiming(0, ROW_T);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${native}, ${label}`}
    >
      <Animated.View style={[styles.option, rtlRow(dir), box]}>
        <Animated.View pointerEvents="none" style={[styles.glowLayer, { boxShadow: REST_GLOW }, rest]} />
        <Animated.View pointerEvents="none" style={[styles.glowLayer, { boxShadow: HOT_GLOW }, hot]} />
        <View style={[styles.optionText, rtlRow(dir)]}>
          <Text style={[styles.optionNative, { color: selected ? C.accent : C.t2 }]}>{native}</Text>
          <Text style={styles.optionLabel}>{label}</Text>
        </View>
        {selected ? <SymbolView name="checkmark" size={13} weight="heavy" tintColor={C.accent} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderRadius: TRIGGER_RADIUS,
    borderWidth: TRIGGER_BORDER,
    borderColor: C.borderLight,
    alignItems: "center",
  },
  // On the border box: absolute insets are measured from the padding box, so
  // −borderWidth reaches the outer edge, whose radius is the full 12.
  triggerGlow: {
    position: "absolute",
    top: -TRIGGER_BORDER,
    left: -TRIGGER_BORDER,
    right: -TRIGGER_BORDER,
    bottom: -TRIGGER_BORDER,
    borderRadius: TRIGGER_RADIUS,
    boxShadow: TRIGGER_SHADOW,
  },
  triggerCompact: { width: 36, height: 36, justifyContent: "center" },
  triggerRow: { height: 36, paddingHorizontal: 12, gap: 6 },
  code: { fontSize: 12, fontWeight: "700" },
  native: { color: C.w, fontSize: 13, fontWeight: "600" },
  // Web: surface bg, rounded-xl, 1px borderLight, `0 16px 40px rgba(0,0,0,.5)`,
  // py-1, min-w-[240px]. No overflow:hidden (it would clip the shadow).
  panel: {
    position: "absolute",
    minWidth: PANEL_MIN_W,
    paddingVertical: 4,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
  },
  searchWrap: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6 },
  search: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    fontSize: 13,
    color: C.w,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  empty: { paddingHorizontal: 12, paddingVertical: 12, fontSize: 12, color: C.t4 },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingHorizontal: 4, paddingBottom: 4, gap: 2 },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  glowLayer: { position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 8 },
  optionText: { alignItems: "center", gap: 8, flexShrink: 1 },
  optionNative: { fontSize: 13, fontWeight: "600" },
  optionLabel: { fontSize: 11, fontWeight: "600", color: C.t4 },
});
