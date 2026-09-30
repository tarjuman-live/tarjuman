/**
 * AnchoredPopover — the web's keep-mounted dropdown recipe (lang-dropdown,
 * locale-switcher, account menu, session-card menu) as a native popover:
 *
 *   open : `animate-in fade-in slide-in-from-top-1 duration-200` (or
 *          -from-bottom-1 when it opens upward) → opacity 0→1, y ∓4→0,
 *          200ms CSS ease
 *   close: `animate-out fade-out slide-out-to-top-1 duration-200`, kept
 *          mounted until it finishes (the web's `visible` state + 200ms timer)
 *   outside tap closes (web: outside mousedown / Escape).
 *
 * Hosted in a transparent <Modal> so it floats above ScrollViews and the
 * native tab bar; positioned from the trigger's measureInWindow().
 *
 *   const trigger = useRef<View>(null);
 *   <PressableScale ref={trigger} glow glowActive={open} onPress={() => setOpen(o => !o)} />
 *   <AnchoredPopover open={open} onClose={() => setOpen(false)} anchorRef={trigger}
 *                    placement="bottom-end" minWidth={200}>
 *     …options…
 *   </AnchoredPopover>
 *
 * placement: "bottom-start" | "bottom-end" | "top-start" | "top-end" |
 *            "auto-start" | "auto-end" (flip up when it won't fit below) |
 *            "left" | "right" (beside the trigger, vertically centred — the
 *            session-card kebab menu; flips side if there is no room).
 * Under Reduce Motion the fade remains, the 4px slide is dropped.
 */
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { C } from "~/lib/theme";
import { EASE, useReduceMotion } from "~/lib/motion";
import { useT } from "~/i18n";
import { usePresenceProgress } from "./presence";

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "auto-start"
  | "auto-end"
  | "left"
  | "right";

export interface AnchoredPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<View | null>;
  placement?: PopoverPlacement;
  /** Gap between trigger and panel (web: 6px dropdowns, 8px side menus). */
  gap?: number;
  /** Keep the panel this far inside the window edges. */
  margin?: number;
  width?: number;
  minWidth?: number;
  maxHeight?: number;
  /** Panel style (defaults: surface bg, radius 12, borderLight, deep shadow). */
  style?: StyleProp<ViewStyle>;
  /** Enter/exit duration (default 200). */
  duration?: number;
  children: ReactNode;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function AnchoredPopover({
  open,
  onClose,
  anchorRef,
  placement = "bottom-end",
  gap = 6,
  margin = 8,
  width,
  minWidth,
  maxHeight,
  style,
  duration = 200,
  children,
}: AnchoredPopoverProps) {
  const t = useT();
  const reduce = useReduceMotion();
  const win = useWindowDimensions();
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null);
  const cfg = { duration, easing: EASE.css };
  const { mounted, progress } = usePresenceProgress(open, { enter: cfg, exit: cfg });

  useEffect(() => {
    if (!open) return;
    anchorRef.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  }, [open, anchorRef]);

  // Resolve side.
  let vertical: "bottom" | "top" | null = null;
  let side: "left" | "right" | null = null;
  const alignEnd = placement.endsWith("end");
  if (placement === "left" || placement === "right") side = placement;
  else if (placement.startsWith("bottom")) vertical = "bottom";
  else if (placement.startsWith("top")) vertical = "top";
  else if (anchor) {
    const below = win.height - (anchor.y + anchor.h) - gap - margin;
    const need = Math.min(panel?.h ?? maxHeight ?? 280, maxHeight ?? Infinity);
    vertical = below >= need || below >= anchor.y ? "bottom" : "top";
  } else vertical = "bottom";

  const pos: ViewStyle = { position: "absolute" };
  if (anchor) {
    if (vertical) {
      if (vertical === "bottom") pos.top = anchor.y + anchor.h + gap;
      else pos.bottom = win.height - anchor.y + gap;
      if (alignEnd) pos.right = Math.max(margin, win.width - (anchor.x + anchor.w));
      else pos.left = Math.max(margin, anchor.x);
    } else if (side) {
      const pw = panel?.w ?? width ?? 176;
      const ph = panel?.h ?? 92;
      let s = side;
      if (s === "left" && anchor.x - gap - pw < margin) s = "right";
      else if (s === "right" && anchor.x + anchor.w + gap + pw > win.width - margin) s = "left";
      pos.left = s === "left" ? anchor.x - gap - pw : anchor.x + anchor.w + gap;
      const top = anchor.y + anchor.h / 2 - ph / 2;
      pos.top = Math.min(Math.max(margin, top), win.height - margin - ph);
    }
  }

  const dy = vertical === "top" ? 4 : -4;
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduce ? 0 : dy * (1 - progress.value) }],
  }));

  const onPanelLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!panel || panel.w !== w || panel.h !== h) setPanel({ w, h });
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("foundation.close")} />
      {anchor ? (
        <Animated.View
          onLayout={onPanelLayout}
          style={[
            styles.panel,
            pos,
            width !== undefined && { width },
            minWidth !== undefined && { minWidth },
            maxHeight !== undefined && { maxHeight },
            style,
            animated,
          ]}
        >
          {children}
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    // No overflow:hidden here — it would clip the box-shadow on iOS. Round
    // inner list backgrounds yourself if they touch the edges.
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5)",
  },
});
