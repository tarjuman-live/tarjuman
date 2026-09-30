/**
 * LangDropdown — port of src/components/session/lang-dropdown.tsx, the compact
 * target-language picker for the AI tools (summary language, study notes,
 * transcript translation).
 *
 * Motion (web → native):
 *   - trigger border borderLight → accent while open (`transition-colors`,
 *     150ms bezier(.4,0,.2,1))
 *   - chevron rotate 0 → 180deg on open and back (`transition-transform
 *     duration-200`, 200ms bezier(.4,0,.2,1))
 *   - panel IN : `animate-in fade-in slide-in-from-top-1 duration-200`
 *     (opacity 0→1, y −4→0, 200ms CSS ease)
 *   - panel OUT: `animate-out fade-out slide-out-to-top-1 duration-200`, kept
 *     mounted through the exit (the web's `visible` state + 200ms timer).
 *   - Reduce Motion: NOT gated. tw-animate-css has no prefers-reduced-motion
 *     rule and globals.css has no global one, so the web keeps the 4px slide
 *     under reduce. The shared AnchoredPopover drops the slide under reduce,
 *     so this file hosts its own keep-mounted panel (LangPanel below) with the
 *     same positioning but an ungated slide (house policy: what the web does
 *     not gate keeps playing).
 *   - Placement: the web anchors with logical `end-0`, so in an RTL UI locale
 *     the panel aligns to the trigger's LEFT edge and opens rightward. The
 *     panel is also clamped inside both window edges.
 *   - option hover (bg → accentSoft, border → accent, glow
 *     0 0 16px rgba(46,204,113,.35), 150ms bezier(.4,0,.2,1)) → press.
 *     The web's inline `borderColor: transparent` accidentally beats
 *     `hover:border-accent`; native shows the border too (the house
 *     green-outline-glow convention).
 *   - disabled: opacity .5, snaps (the web trigger only transitions colours).
 *   - option select: the same `transition-all duration-150` eases the inline
 *     selected styles, so on a pick the old row fades bg/border/label out of
 *     accent and the new row fades in (150ms tw) during the panel exit.
 *
 * Contract (CONTRACTS.md): { value, onChange, label? }. `disabled` is an
 * additive optional prop (the web component has it; the AI tools disable the
 * picker while a run is streaming).
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { LANGUAGES } from "@shared/constants";
import { C } from "~/lib/theme";
import { langName } from "~/lib/lang";
import { EASE } from "~/lib/motion";
import { rtlRow, useLocale } from "~/i18n";
import { usePresenceProgress } from "./motion/presence";

export interface LangDropdownProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  /** Web parity: the AI tools disable the picker while a run streams. */
  disabled?: boolean;
}

const ACCENT_CLEAR = "rgba(46,204,113,0)";
const OPTION_GLOW = "0 0 16px rgba(46,204,113,0.35)";
const PANEL_GAP = 6; // mt-1.5

export function LangDropdown({ value, onChange, label, disabled = false }: LangDropdownProps) {
  const { t, dir } = useLocale();
  const win = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);

  // Trigger border (transition-colors 150ms) + chevron rotate (200ms).
  const openBorder = useSharedValue(0);
  const rotate = useSharedValue(0);
  useEffect(() => {
    openBorder.value = withTiming(open ? 1 : 0, {
      duration: 150,
      easing: EASE.tw,
      reduceMotion: ReduceMotion.Never,
    });
    rotate.value = withTiming(open ? 180 : 0, {
      duration: 200,
      easing: EASE.tw,
      reduceMotion: ReduceMotion.Never,
    });
  }, [open, openBorder, rotate]);

  // A picker disabled mid-open (a run just started) closes, like the web's
  // disabled button no longer receiving the toggle.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const triggerStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(openBorder.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }],
  }));

  // max-h-[50vh]
  const maxHeight = Math.round(win.height * 0.5);

  return (
    <>
      <View ref={anchor} collapsable={false} style={disabled ? styles.disabled : undefined}>
        <Pressable
          disabled={disabled}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={label ?? t("proTools.language")}
          accessibilityState={{ expanded: open, disabled }}
        >
          <Animated.View style={[styles.trigger, rtlRow(dir), triggerStyle]}>
            <Text style={styles.triggerText} numberOfLines={1}>
              {label ? `${label}: ` : ""}
              {langName(value)}
            </Text>
            <Animated.View style={chevronStyle}>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M6 9l6 6 6-6"
                  stroke={C.w}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Animated.View>
          </Animated.View>
        </Pressable>
      </View>

      <LangPanel
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("foundation.close")}
        anchorRef={anchor}
        // Web `end-0` is logical: right edge in LTR, left edge in RTL.
        alignEnd={dir !== "rtl"}
        gap={PANEL_GAP}
        minWidth={200}
        maxHeight={maxHeight}
      >
        <ScrollView
          style={{ maxHeight: maxHeight - 2 }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator
          accessibilityRole="list"
        >
          {LANGUAGES.map((l) => (
            <LangOption
              key={l.code}
              native={l.native}
              name={l.name}
              selected={l.code === value}
              rowDir={dir}
              onPick={() => {
                void Haptics.selectionAsync().catch(() => {});
                onChange(l.code);
                setOpen(false);
              }}
            />
          ))}
        </ScrollView>
      </LangPanel>
    </>
  );
}

/**
 * Keep-mounted dropdown panel — AnchoredPopover's recipe (transparent Modal,
 * measureInWindow anchor, auto flip up/down, outside tap closes, fade + 4px
 * slide 200ms CSS ease in AND out) with two differences the web requires:
 * the slide is not dropped under Reduce Motion, and the panel is clamped
 * inside both window edges whichever side it aligns to.
 */
const PANEL_MS = 200;
const PANEL_MARGIN = 8;

function LangPanel({
  open,
  onClose,
  closeLabel,
  anchorRef,
  alignEnd,
  gap,
  minWidth,
  maxHeight,
  children,
}: {
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  anchorRef: RefObject<View | null>;
  alignEnd: boolean;
  gap: number;
  minWidth: number;
  maxHeight: number;
  children: ReactNode;
}) {
  const win = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null);
  const cfg = { duration: PANEL_MS, easing: EASE.css, reduceMotion: ReduceMotion.Never };
  const { mounted, progress } = usePresenceProgress(open, { enter: cfg, exit: cfg });

  useEffect(() => {
    if (!open) return;
    anchorRef.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  }, [open, anchorRef]);

  let vertical: "bottom" | "top" = "bottom";
  const pos: ViewStyle = { position: "absolute" };
  if (anchor) {
    const below = win.height - (anchor.y + anchor.h) - gap - PANEL_MARGIN;
    const need = Math.min(panel?.h ?? maxHeight, maxHeight);
    vertical = below >= need || below >= anchor.y ? "bottom" : "top";
    if (vertical === "bottom") pos.top = anchor.y + anchor.h + gap;
    else pos.bottom = win.height - anchor.y + gap;
    const pw = panel?.w ?? minWidth;
    const maxEdge = Math.max(PANEL_MARGIN, win.width - PANEL_MARGIN - pw);
    if (alignEnd) {
      pos.right = Math.min(Math.max(PANEL_MARGIN, win.width - (anchor.x + anchor.w)), maxEdge);
    } else {
      pos.left = Math.min(Math.max(PANEL_MARGIN, anchor.x), maxEdge);
    }
  }

  // slide-in-from-top-1 (or -from-bottom-1 when flipped up): ∓4px → 0.
  const dy = vertical === "top" ? 4 : -4;
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: dy * (1 - progress.value) }],
  }));

  const onPanelLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!panel || panel.w !== w || panel.h !== h) setPanel({ w, h });
  };

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
      {anchor ? (
        <Animated.View
          onLayout={onPanelLayout}
          style={[styles.panel, pos, { minWidth, maxHeight }, animated]}
        >
          {children}
        </Animated.View>
      ) : null}
    </Modal>
  );
}

function LangOption({
  native,
  name,
  selected,
  rowDir,
  onPick,
}: {
  native: string;
  name: string;
  selected: boolean;
  rowDir: "ltr" | "rtl";
  onPick: () => void;
}) {
  // Web hover (transition-all duration-150) → press.
  const p = useSharedValue(0);
  const cfg = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
  // Selection crossfade: the rows' `transition-all duration-150` also eases the
  // inline selected styles (bg / border / text colour), so on a pick the old
  // row fades out of accent and the new one fades in while the panel leaves.
  const sel = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    sel.value = withTiming(selected ? 1 : 0, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const rowStyle = useAnimatedStyle(() => {
    const bgFrom = interpolateColor(sel.value, [0, 1], [ACCENT_CLEAR, C.accentSoft]);
    const borderFrom = interpolateColor(sel.value, [0, 1], [ACCENT_CLEAR, C.accent]);
    return {
      backgroundColor: interpolateColor(p.value, [0, 1], [bgFrom, C.accentSoft]) as string,
      borderColor: interpolateColor(p.value, [0, 1], [borderFrom, C.accent]) as string,
    };
  });
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [C.t2, C.accent]) as string,
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: p.value }));

  return (
    <Pressable
      onPress={onPick}
      onPressIn={() => {
        p.value = withTiming(1, cfg);
      }}
      onPressOut={() => {
        p.value = withTiming(0, cfg);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${native}, ${name}`}
    >
      <Animated.View style={[styles.option, rtlRow(rowDir), rowStyle]}>
        <Animated.View pointerEvents="none" style={[styles.optionGlow, glowStyle]} />
        <View style={[styles.optionLabel, rtlRow(rowDir)]}>
          <Animated.Text style={[styles.optionNative, labelStyle]}>{native}</Animated.Text>
          <Text style={styles.optionName}>{name}</Text>
        </View>
        {selected ? (
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path
              d="M5 13l4 4L19 7"
              stroke={C.accent}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  // Same panel chrome as AnchoredPopover (surface, rounded-xl, borderLight,
  // deep shadow). No overflow:hidden — it would clip the shadow.
  panel: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
  },
  // h-9 px-3 rounded-xl gap-1.5, surfaceLight, 1px border
  trigger: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: C.surfaceLight,
    alignItems: "center",
    gap: 6,
  },
  triggerText: { color: C.w, fontSize: 13, fontWeight: "600" },
  // panel py-1; inner px-1 pb-1 gap-0.5
  list: { paddingTop: 4, paddingBottom: 8, paddingHorizontal: 4, gap: 2 },
  // px-3 py-2 rounded-lg border, justify-between gap-3
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  optionGlow: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 8,
    boxShadow: OPTION_GLOW,
  },
  optionLabel: { alignItems: "center", gap: 8, flexShrink: 1 },
  optionNative: { fontSize: 13, fontWeight: "600" },
  optionName: { fontSize: 11, fontWeight: "600", color: C.t4 },
});
