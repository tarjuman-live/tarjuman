/**
 * Tab navigation. This is the native port of the web's two nav shells:
 *   - src/components/layout/bottom-nav.tsx: the floating glass capsule with the
 *     liquid-glass selection lens. Used on phones.
 *   - src/components/layout/sidebar.tsx: the ≥lg (1024pt) rail with the
 *     gliding nav pill. Used on an iPad-width window.
 *
 * We use a custom JS tab bar, not NativeTabs/UITabBarController. The system
 * bar cannot reproduce the web's motion. On iOS 16–18 it has no lens, no
 * swell, no blur and no press scale, and it swaps the selection colour
 * instantly. On iOS 26 its lens runs Apple's spring, not ours. It also hides
 * with `setTabBarHidden:animated:NO`, so the recording hide-slide snapped.
 * Every value below is lifted from the web source.
 *
 * BOTTOM NAV (bottom-nav.tsx / globals.css)
 *   - Capsule: fixed, centred, bottom = safe-area + 12. Glass is
 *     rgba(20,28,46,.6) with blur(28px), a 1px white@10 border, the shadow
 *     0 12px 40px black@50 plus inset highlights, and padding 5.
 *   - Lens: absolute, 4px inset, width TAB_WIDTH + 2, white@8 fill with inset
 *     rims. It sits ABOVE the tabs and passes touches through.
 *     x = useSpring(visualDuration .42, bounce .16) → SPRING.lens (exact
 *     conversion). Retargeting keeps its velocity, as Reanimated's withSpring
 *     does. Reduce Motion jumps it to the slot with no velocity.
 *   - Swell: the lens tracks its own velocity, v = dx/dt measured per frame
 *     (a stand-in for motion's useVelocity):
 *     swell = min(|v| / 420, 1), scaleX 1→1.07, scaleY 1→1.14.
 *   - `.nav-lens-flying` adds blur(6px) saturate(140%) above the icons while
 *     |v| > 8 px/s. Like the web class toggle, it snaps on and off.
 *   - Tabs: `transition-transform duration-150 active:scale-95` → press scale
 *     .95, 150ms Tailwind curve. Icon and label colour t2 ↔ accent use
 *     `transition-colors duration-200` → a 200ms crossfade on the Tailwind
 *     curve. SF Symbol tints cannot be animated, so two tinted glyphs are
 *     stacked and crossfaded. The glyph stays the same in both states, as on
 *     the web.
 *   - Hide (NavVisibility; Record publishes it while a session is live):
 *     translateY(calc(100% + 28px)) plus a fade, 320ms. The transform uses
 *     bezier(.4,0,.2,1) and the opacity uses CSS ease, in both directions.
 *     Touches are off while hidden. This is a plain CSS transition on the web,
 *     so it is not gated by Reduce Motion. The fade never puts alpha on the
 *     glass's ancestor (UIKit drops a UIVisualEffectView's blur under an
 *     alpha < 1 ancestor): FadeGlass ramps the blur intensity and fades the
 *     tint + frame, the tabs and the lens face fade in their own layers, and
 *     the lens's flying blur ramps its intensity — so the backdrop blur fades
 *     WITH the opacity, as the web's backdrop-filter does.
 *
 * SIDEBAR RAIL (sidebar.tsx / globals.css `.sidebar-nav-pill`)
 *   - Island tile: w256, radius 20 (web w240 / 16, scaled for iPad), surface, a borderLight border and a soft
 *     shadow, in a 12pt gutter.
 *   - Pill: ONE pill glides to whichever item is active (nav, session rows,
 *     live row, View all) — y AND height, 320ms bezier(.3,.9,.4,1). It is instant
 *     under Reduce Motion, which the web gates with its own media query. It
 *     carries accentSoft, a 1px accent border and a 0 0 16px accent@25 glow.
 *   - Inactive items: `transition-all duration-200` hover → press. Border goes
 *     transparent → accent, background → accent-soft, glow 0 0 16px
 *     accent@35. Text colour crossfades over 200ms and the icon over 150ms
 *     (`transition-colors`). Those layers stay mounted on every item, so the
 *     item that becomes active fades its border/bg/glow OUT over 200ms while
 *     the pill glides in, as the web's dropped hover: classes do.
 *   - No brand tile: the web rail's logo row is dropped on iPad (the nav
 *     starts the rail).
 *   - Footer (web `<LocaleSwitcher compact dropUp /><AccountMenu dropUp />`):
 *     the locale pill plus the AccountMenu in its drop-UP variant — panel
 *     `bottom-full mb-2 origin-bottom-left`, fade + zoom .95 + 4px slide from
 *     below, 200ms CSS ease, in AND out (see account-card.tsx). The web hides
 *     the per-page Record header at lg: RailLayoutProvider/RailSlot make any
 *     header-placed locale pill / AccountMenu render nothing while the rail
 *     is up (useRailLayout().railActive lets a screen hide the rest).
 *   - RTL UI: the rail docks on the RIGHT (web <html dir=rtl> flips the
 *     lg:flex row) and the safe-area gutter mirrors with it.
 *
 * RTL (UI language): the tab order mirrors and the lens slot index mirrors
 * with it, so the lens always sits under the active tab.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { C, themed, themedShadow, getThemeMode } from "~/lib/theme";
import { EASE, SPRING, TW_ENTER, TW_EXIT, useReduceMotion } from "~/lib/motion";
import { rtlRow, rtlText, useLocale, type MessageKey } from "~/i18n";
import { liveElapsed, useLiveSession, useRecordNavHidden, type LiveSessionInfo } from "~/components/record-button";
import { usePulse } from "~/components/motion/pulse";
import { useQuery } from "convex/react";
import { api } from "@convex/api";
import { formatDate, formatDuration, langName } from "~/lib/lang";
import { LocaleSwitcher, RailLayoutProvider, RailSlot } from "~/components/locale-switcher";
import { AccountMenu, FADE_GLASS_FRAME, FadeGlass } from "~/components/account-card";
import { PressableScale } from "~/components/motion";
import { TABLET_TOP } from "~/lib/layout";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TABS: Record<string, { icon: SFSymbol; labelKey: MessageKey }> = {
  index: { icon: "mic", labelKey: "nav.record" },
  history: { icon: "clock.arrow.circlepath", labelKey: "nav.history" },
};

// bottom-nav.tsx constants.
const TAB_WIDTH = 100;
const LENS_INSET = 4;
const NAV_PAD = 5;
const PEAK_V = 420;
const FLYING_V = 8;
/** `.nav-lens-flying` blur(6px). GlassBackground uses 60 for its 28px blur. */
const FLYING_BLUR = 13;

// sidebar.tsx constants, scaled up for the iPad (the rail only exists at
// ≥1024pt, i.e. a full-screen iPad): 52pt items, 16pt labels, 22pt icons.
const RAIL_ITEM_H = 52;
/**
 * Concentric corners: the nav sits RAIL_INSET from the island's top and
 * sides, and the pill / item radius is the island's radius minus that inset,
 * so the selected pill's curve runs parallel to the island's instead of
 * looking jammed into its corner (user: "not good at the top", 2026-10-13).
 */
const RAIL_RADIUS = 26;
const RAIL_INSET = 14;
const RAIL_ITEM_RADIUS = RAIL_RADIUS - RAIL_INSET;
const PILL_EASE = Easing.bezier(0.3, 0.9, 0.4, 1);
/** lg breakpoint. At or above it the web swaps the bottom nav for the sidebar. */
const LG = 1024;

const HIDE_MS = 320;
/** bottom-nav.tsx capsule drop shadow (drawn by FadeGlass's frame layer). */
const CAPSULE_SHADOW = "0 12px 40px rgba(0, 0, 0, 0.5)";
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const COLOR_T = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
const ICON_T = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const rail = width >= LG;
  // The web sets <html dir="rtl"> for Arabic/Urdu UI, and <Sidebar/> is the
  // first child of the lg:flex row, so the rail sits on the RIGHT edge there.
  const { isRtl } = useLocale();
  return (
    <RailLayoutProvider active={rail}>
      <Tabs
        tabBar={(props) => (rail ? <SidebarRail {...props} /> : <BottomNav {...props} />)}
        screenOptions={{
          headerShown: false,
          tabBarPosition: rail ? (isRtl ? "right" : "left") : "bottom",
          sceneStyle: { backgroundColor: C.bg },
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="history" />
        {/* iPad: a session opened from the sidebar / History, shown BESIDE
            the sidebar (not in the tab bar; phones push session/[id]). */}
        <Tabs.Screen name="s/[id]" />
      </Tabs>
    </RailLayoutProvider>
  );
}

/** Standard tab press: emit tabPress, then navigate unless already focused or prevented. */
function useTabPress({ state, navigation }: TabBarProps) {
  return useCallback(
    (index: number) => {
      const route = state.routes[index];
      if (!route) return;
      const focused = state.index === index;
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    },
    [state, navigation]
  );
}

// ─── Shared: colour crossfade parts ─────────────────────────────────────────

/** Two stacked SF Symbols (t2 / accent) crossfaded by `sel` (0 → 1). */
function CrossfadeIcon({ name, size, sel }: { name: SFSymbol; size: number; sel: SharedValue<number> }) {
  const on = useAnimatedStyle(() => ({ opacity: sel.value }));
  const off = useAnimatedStyle(() => ({ opacity: 1 - sel.value }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, off]}>
        <SymbolView name={name} size={size} tintColor={C.t2} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, on]}>
        <SymbolView name={name} size={size} tintColor={C.accent} />
      </Animated.View>
    </View>
  );
}

/** A 0/1 selection progress that eases whenever `active` flips. */
function useSelection(active: boolean, cfg: typeof COLOR_T) {
  const sel = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    sel.value = withTiming(active ? 1 : 0, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return sel;
}

// ─── Bottom nav (phones) ────────────────────────────────────────────────────

function BottomNav(props: TabBarProps) {
  const { state, insets } = props;
  const { t, dir, isRtl } = useLocale();
  const reduce = useReduceMotion();
  const hidden = useRecordNavHidden();
  const onTab = useTabPress(props);
  // Only real tabs count (the hidden iPad "s/[id]" route is never a slot).
  const n = state.routes.filter((r) => TABS[r.name]).length;
  const slotX = (i: number) => (isRtl ? n - 1 - i : i) * TAB_WIDTH;

  // ── Lens spring + velocity tracking ──
  const x = useSharedValue(slotX(state.index));
  const prevX = useSharedValue(x.value);
  const speed = useSharedValue(0);
  const tracker = useFrameCallback((f) => {
    const dt = f.timeSincePreviousFrame;
    if (dt && dt > 0) speed.value = ((x.value - prevX.value) / dt) * 1000;
    prevX.value = x.value;
  }, false);
  const stopTracking = useCallback(() => tracker.setActive(false), [tracker]);

  const target = slotX(state.index);
  useEffect(() => {
    if (reduce) {
      // motion `x.jump(target)`: set without animating and without velocity.
      cancelAnimation(x);
      x.value = target;
      prevX.value = target;
      speed.value = 0;
      tracker.setActive(false);
      return;
    }
    prevX.value = x.value;
    tracker.setActive(true);
    x.value = withSpring(target, { ...SPRING.lens, reduceMotion: ReduceMotion.Never }, (finished) => {
      "worklet";
      if (finished) {
        speed.value = 0;
        scheduleOnRN(stopTracking);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce]);

  const lensStyle = useAnimatedStyle(() => {
    const swell = Math.min(Math.abs(speed.value) / PEAK_V, 1);
    return {
      transform: [{ translateX: x.value }, { scaleX: 1 + 0.07 * swell }, { scaleY: 1 + 0.14 * swell }],
    };
  });
  const flyingStyle = useAnimatedStyle(() => ({ opacity: Math.abs(speed.value) > FLYING_V ? 1 : 0 }));

  // ── NavVisibility hide-slide ──
  const [barH, setBarH] = useState(68);
  const onLayout = (e: LayoutChangeEvent) => setBarH(e.nativeEvent.layout.height);
  const hide = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    hide.value = withTiming(hidden ? 1 : 0, { duration: HIDE_MS, easing: EASE.tw, reduceMotion: ReduceMotion.Never });
  }, [hidden, hide]);
  const fade = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    fade.value = withTiming(hidden ? 0 : 1, { duration: HIDE_MS, easing: EASE.css, reduceMotion: ReduceMotion.Never });
  }, [hidden, fade]);
  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hide.value * (barH + 28) }],
  }));
  const contentFade = useAnimatedStyle(() => ({ opacity: fade.value }));
  const flyingBlur = useAnimatedProps(() => ({ intensity: FLYING_BLUR * fade.value }));

  return (
    <View pointerEvents="box-none" style={[styles.navHost, { bottom: insets.bottom + 12 }]}>
      <Animated.View
        onLayout={onLayout}
        pointerEvents={hidden ? "none" : "auto"}
        accessibilityRole="tablist"
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
        style={[styles.capsule, FADE_GLASS_FRAME, capsuleStyle]}
      >
        <FadeGlass progress={fade} radius={999} shadow={themedShadow(CAPSULE_SHADOW)} />
        <Animated.View style={[styles.tabRow, rtlRow(dir), contentFade]}>
          {state.routes.map((route, i) => {
            const meta = TABS[route.name];
            if (!meta) return null;
            return (
              <BottomTab
                key={route.key}
                icon={meta.icon}
                label={t(meta.labelKey)}
                active={state.index === i}
                onPress={() => onTab(i)}
              />
            );
          })}
        </Animated.View>
        {/* The lens, above the tabs and passing touches through. */}
        <Animated.View pointerEvents="none" style={[styles.lens, lensStyle]}>
          <Animated.View style={[styles.lensFace, contentFade]} />
          <Animated.View style={[styles.lensClip, flyingStyle]}>
            <AnimatedBlurView tint="default" animatedProps={flyingBlur} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function BottomTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: SFSymbol;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const sel = useSelection(active, COLOR_T);
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [C.t2, C.accent]) as string,
  }));
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.95}
      duration={150}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={styles.tab}
    >
      <CrossfadeIcon name={icon} size={22} sel={sel} />
      <Animated.Text numberOfLines={1} style={[styles.tabLabel, labelStyle]}>
        {label}
      </Animated.Text>
    </PressableScale>
  );
}

// ─── Sidebar rail (≥ lg windows) ────────────────────────────────────────────

/**
 * iPad sidebar (design approved 2026-10-11 from the interactive preview):
 *
 *   Record · History            ← nav buttons
 *   RECENT
 *   ● Recording   12:04         ← only while a session is live
 *   <session> … <session>       ← as many recent sessions as fit
 *   View all in History         ← a nav button, same look as Record/History
 *   EN · avatar                 ← footer
 *
 * ONE green pill glides between EVERY item — nav buttons, session rows, the
 * live row, View all — resizing to each item's height (320ms bezier(.3,.9,
 * .4,1)), never snapping. A session opens BESIDE the sidebar (the hidden
 * "s/[id]" tab route), so the sidebar stays put. Rows that join or leave
 * (the live row, a new session) slide the rest with a layout transition and
 * the pill follows them.
 */
type RailKey = string; // "record" | "history" | "all" | "live" | `s:${id}`

const ROW_H = 60;
const ITEM_GAP = 4;
const LABEL_H = 44;
const VIEW_ALL_GAP = 8;
const RAIL_ROW_MOVE = LinearTransition.duration(300).easing(EASE.smooth);

function SidebarRail(props: TabBarProps) {
  const { state, insets, navigation } = props;
  const { t, dir, isRtl } = useLocale();
  const reduce = useReduceMotion();
  const onTab = useTabPress(props);
  const live = useLiveSession();
  const sessions = useQuery(api.sessions.getRecentSessions, { limit: 24 });
  const [tapKey, setTapKey] = useState<RailKey | null>(null);
  const [colH, setColH] = useState(0);
  const [layouts, setLayouts] = useState<Record<RailKey, { y: number; h: number }>>({});

  // How many recent sessions fit between the nav and View all — no scrolling
  // list inside the sidebar; the rest is one tap away in History.
  const total = sessions?.length ?? 0;
  const fixed =
    2 * RAIL_ITEM_H + ITEM_GAP + LABEL_H + (live ? ROW_H + ITEM_GAP : 0) + VIEW_ALL_GAP + RAIL_ITEM_H + RAIL_INSET;
  const fit = colH > 0 ? Math.max(0, Math.floor((colH - fixed) / (ROW_H + ITEM_GAP))) : 0;
  const shown = (sessions ?? []).slice(0, fit);

  const focused = state.routes[state.index];
  const openId = focused?.name === "s/[id]" ? (focused.params as { id?: string } | undefined)?.id : undefined;
  const selKey: RailKey =
    focused?.name === "history"
      ? tapKey === "all"
        ? "all"
        : "history"
      : openId
        ? shown.some((s) => s._id === openId)
          ? `s:${openId}`
          : "history"
        : tapKey === "live" && live
          ? "live"
          : "record";

  const setLayout = useCallback((key: RailKey, e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setLayouts((prev) => {
      const old = prev[key];
      if (old && old.y === y && old.h === height) return prev;
      return { ...prev, [key]: { y, h: height } };
    });
  }, []);

  // ── The pill ──
  const pillY = useSharedValue(0);
  const pillH = useSharedValue(RAIL_ITEM_H);
  const pillO = useSharedValue(0);
  const placed = useRef(false);
  const target = layouts[selKey];
  useEffect(() => {
    if (!target) {
      pillO.value = withTiming(0, { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never });
      return;
    }
    if (reduce || !placed.current) {
      cancelAnimation(pillY);
      cancelAnimation(pillH);
      pillY.value = target.y;
      pillH.value = target.h;
    } else {
      const cfg = { duration: 320, easing: PILL_EASE, reduceMotion: ReduceMotion.Never };
      pillY.value = withTiming(target.y, cfg);
      pillH.value = withTiming(target.h, cfg);
    }
    placed.current = true;
    pillO.value = withTiming(1, { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never });
  }, [target?.y, target?.h, reduce, pillY, pillH, pillO, target]);
  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillO.value,
    height: pillH.value,
    transform: [{ translateY: pillY.value }],
  }));

  const go = {
    record: () => {
      setTapKey("record");
      onTab(state.routes.findIndex((r) => r.name === "index"));
    },
    history: (key: "history" | "all") => {
      setTapKey(key);
      onTab(state.routes.findIndex((r) => r.name === "history"));
    },
    live: () => {
      setTapKey("live");
      onTab(state.routes.findIndex((r) => r.name === "index"));
    },
    session: (id: string) => {
      setTapKey(`s:${id}`);
      if (openId !== id) navigation.navigate("s/[id]", { id });
    },
  };

  return (
    <View
      style={[
        styles.railHost,
        {
          // Shares the content's top line (TABLET_TOP) instead of hugging the
          // status bar, so the island and the page start at the same height.
          paddingTop: insets.top + TABLET_TOP,
          paddingBottom: insets.bottom + 12,
          // `lg:p-3` gutter: the outer (screen) edge also clears the safe
          // area, and it mirrors with the rail's side in an RTL UI language.
          paddingLeft: isRtl ? 12 : insets.left + 12,
          paddingRight: isRtl ? insets.right + 12 : 12,
        },
      ]}
    >
      <View style={styles.rail}>
        <View
          style={styles.railCol}
          accessibilityRole="tablist"
          onLayout={(e) => setColH(e.nativeEvent.layout.height)}
        >
          <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />
          <LayoutAnimationConfig skipEntering>
            <Animated.View layout={reduce ? undefined : RAIL_ROW_MOVE} onLayout={(e) => setLayout("record", e)}>
              <RailItem
                icon="mic"
                label={t("nav.record")}
                active={selKey === "record"}
                rowStyle={rtlRow(dir)}
                onPress={go.record}
              />
            </Animated.View>
            <Animated.View
              layout={reduce ? undefined : RAIL_ROW_MOVE}
              style={{ marginTop: ITEM_GAP }}
              onLayout={(e) => setLayout("history", e)}
            >
              <RailItem
                icon="clock.arrow.circlepath"
                label={t("nav.history")}
                active={selKey === "history"}
                rowStyle={rtlRow(dir)}
                onPress={() => go.history("history")}
              />
            </Animated.View>

            {shown.length > 0 || live ? (
              <Animated.View
                entering={TW_ENTER.fade}
                exiting={TW_EXIT.fade}
                layout={reduce ? undefined : RAIL_ROW_MOVE}
                style={styles.railLabelWrap}
              >
                <Text style={[styles.railSection, rtlText(dir)]}>{t("record.recent")}</Text>
              </Animated.View>
            ) : null}

            {live ? (
              <Animated.View
                key="live"
                entering={TW_ENTER.fade}
                exiting={TW_EXIT.fade}
                layout={reduce ? undefined : RAIL_ROW_MOVE}
                style={{ marginBottom: ITEM_GAP }}
                onLayout={(e) => setLayout("live", e)}
              >
                <LiveRailRow info={live} active={selKey === "live"} onPress={go.live} />
              </Animated.View>
            ) : null}

            {shown.map((s, i) => (
              <Animated.View
                key={s._id}
                entering={TW_ENTER.fade}
                exiting={TW_EXIT.fade}
                layout={reduce ? undefined : RAIL_ROW_MOVE}
                style={i > 0 ? { marginTop: ITEM_GAP } : undefined}
                onLayout={(e) => setLayout(`s:${s._id}`, e)}
              >
                <RailItem
                  title={s.title || s.firstSegmentText || t("record.untitled")}
                  subtitle={`${formatDate(s.createdAt)} · ${formatDuration(s.duration)}`}
                  height={ROW_H}
                  active={selKey === `s:${s._id}`}
                  rowStyle={rtlRow(dir)}
                  onPress={() => go.session(s._id)}
                />
              </Animated.View>
            ))}

            {total > 0 ? (
              <Animated.View
                entering={TW_ENTER.fade}
                exiting={TW_EXIT.fade}
                layout={reduce ? undefined : RAIL_ROW_MOVE}
                style={{ marginTop: VIEW_ALL_GAP }}
                onLayout={(e) => setLayout("all", e)}
              >
                <RailItem
                  icon="list.bullet"
                  label={t("session.viewAllHistory")}
                  active={selKey === "all"}
                  rowStyle={rtlRow(dir)}
                  onPress={() => go.history("all")}
                />
              </Animated.View>
            ) : null}
          </LayoutAnimationConfig>
        </View>

        <View style={[styles.railFooter, rtlRow(dir)]}>
          <RailSlot>
            <LocaleSwitcher variant="pill" dropUp />
            <AccountMenu dropUp />
          </RailSlot>
        </View>
      </View>
    </View>
  );
}

/** The live session's row: pulsing red dot, "Recording", running timer, pair. */
function LiveRailRow({ info, active, onPress }: { info: LiveSessionInfo; active: boolean; onPress: () => void }) {
  const { t, dir } = useLocale();
  // The clock lives in state (not Date.now() during render): the React
  // Compiler memoises render output, so an impure read would freeze at 0:00.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (info.since === null) return; // paused: the clock is frozen
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [info.since, info.accumulated]);
  const pulse = usePulse();
  return (
    <RailItem
      title={t("record.recording")}
      titleColor={C.red}
      subtitle={`${langName(info.source)} → ${langName(info.target)}`}
      trailing={formatDuration(liveElapsed(info, now))}
      leading={<Animated.View style={[styles.liveDot, pulse]} />}
      height={ROW_H}
      active={active}
      rowStyle={rtlRow(dir)}
      onPress={onPress}
    />
  );
}

/** Rail item `transition-all duration-200` (Tailwind curve) hover → press. */
const RAIL_HOVER_T = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function RailItem({
  icon,
  label,
  title,
  titleColor,
  subtitle,
  trailing,
  leading,
  height = RAIL_ITEM_H,
  active,
  rowStyle,
  onPress,
}: {
  icon?: SFSymbol;
  /** One-line nav label (Record / History / View all). */
  label?: string;
  /** Two-line row title (sessions, live row). */
  title?: string;
  titleColor?: string;
  subtitle?: string;
  trailing?: string;
  leading?: ReactNode;
  height?: number;
  active: boolean;
  rowStyle: ReturnType<typeof rtlRow>;
  onPress: () => void;
}) {
  const { dir } = useLocale();
  const text = useSelection(active, COLOR_T);
  const iconSel = useSelection(active, ICON_T);
  const rest = titleColor ?? (label ? C.t2 : C.w);
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(text.value, [0, 1], [rest, titleColor ?? C.accent]) as string,
  }));

  // Hover → press. The glow / bg / border layers stay MOUNTED on every item:
  // on the web the item that becomes active loses its hover: classes under
  // `transition-all duration-200`, so its accent border, accent-soft bg and
  // glow FADE OUT (200ms) while the pill glides in (320ms). The active item
  // never lights (its outline is the pill's), and flipping to active drives
  // any held press state back to 0 over the same 200ms.
  const hov = useSharedValue(0);
  useEffect(() => {
    if (active) hov.value = withTiming(0, RAIL_HOVER_T);
  }, [active, hov]);
  const itemStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(hov.value, [0, 1], ["rgba(46, 204, 113, 0)", C.accentSoft]) as string,
    borderColor: interpolateColor(hov.value, [0, 1], ["rgba(46, 204, 113, 0)", C.accent]) as string,
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: hov.value }));
  const a11y = label ?? [title, subtitle, trailing].filter(Boolean).join(", ");

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        if (!active) hov.value = withTiming(1, RAIL_HOVER_T);
      }}
      onPressOut={() => {
        hov.value = withTiming(0, RAIL_HOVER_T);
      }}
      accessibilityRole="tab"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      style={[styles.railItem, { height }, rowStyle, itemStyle]}
    >
      <Animated.View pointerEvents="none" style={[styles.railGlow, glowStyle]} />
      {icon ? <CrossfadeIcon name={icon} size={22} sel={iconSel} /> : null}
      {label ? (
        <Animated.Text numberOfLines={1} style={[styles.railLabel, labelStyle]}>
          {label}
        </Animated.Text>
      ) : (
        <View style={styles.railTwoLine}>
          <View style={[styles.railTitleRow, rtlRow(dir)]}>
            {leading}
            <Animated.Text numberOfLines={1} style={[styles.railTitle, rtlText(dir), labelStyle]}>
              {title}
            </Animated.Text>
            {trailing ? <Text style={styles.railTrailing}>{trailing}</Text> : null}
          </View>
          {subtitle ? (
            <Text numberOfLines={1} style={[styles.railSubtitle, rtlText(dir)]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = themed(() => StyleSheet.create({
  // Bottom nav
  navHost: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  capsule: {
    borderRadius: 999,
    padding: NAV_PAD,
  },
  tabRow: { flexDirection: "row", alignItems: "center" },
  tab: {
    width: TAB_WIDTH,
    alignItems: "center",
    gap: 3,
    paddingVertical: 7,
    borderRadius: 999,
  },
  tabLabel: {
    width: "100%",
    paddingHorizontal: 4,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: "600",
  },
  lens: {
    position: "absolute",
    top: LENS_INSET,
    bottom: LENS_INSET,
    left: LENS_INSET,
    width: TAB_WIDTH + 2 * (NAV_PAD - LENS_INSET),
    borderRadius: 999,
  },
  lensFace: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    // Light mode: a white lens reads as nothing on white glass — tint it with
    // the accent instead so the selected tab stays obvious.
    backgroundColor: getThemeMode() === "light" ? C.accentSoft : "rgba(255, 255, 255, 0.08)",
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 1px rgba(0, 0, 0, 0.25), 0 2px 10px rgba(0, 0, 0, 0.25)",
  },
  lensClip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, overflow: "hidden" },

  // Sidebar rail
  railHost: { height: "100%" },
  rail: {
    flex: 1,
    width: 256,
    borderRadius: RAIL_RADIUS,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  },
  // The rail's single column: every item (and the pill) is a direct child, so
  // each onLayout y is in the same coordinate space as the pill.
  railCol: { flex: 1, marginTop: RAIL_INSET, marginHorizontal: RAIL_INSET, overflow: "hidden" },
  railLabelWrap: { height: LABEL_H, justifyContent: "flex-end", paddingHorizontal: 14, paddingBottom: 10 },
  railSection: { color: C.t3, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  railTwoLine: { flex: 1, minWidth: 0, gap: 3 },
  railTitleRow: { alignItems: "center", gap: 8 },
  railTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  railTrailing: { color: C.red, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  railSubtitle: { color: C.t4, fontSize: 13 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.red },
  pill: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: RAIL_ITEM_H,
    borderRadius: RAIL_ITEM_RADIUS,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: C.accent,
    boxShadow: `0 0 16px ${C.accent}40`,
  },
  railItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: RAIL_ITEM_H,
    paddingHorizontal: 14,
    borderRadius: RAIL_ITEM_RADIUS,
    borderWidth: 1,
    borderColor: "transparent",
  },
  railLabel: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  /** Hover glow 0 0 16px accent@35, faded by the item's press/hover value. */
  railGlow: {
    position: "absolute",
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: RAIL_ITEM_RADIUS + 1,
    boxShadow: "0 0 16px rgba(46, 204, 113, 0.35)",
  },
  railFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    // Same inset as the nav (top) so both ends of the island match.
    paddingHorizontal: RAIL_INSET,
    paddingVertical: RAIL_INSET,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
}));
