/**
 * GlassDialog — the centred liquid-glass modal shell shared by ConfirmDialog,
 * PromptDialog (and usable for the auth card / upgrade celebration). Mirrors
 * the Radix dialogs in src/components/shared/{confirm,prompt}-dialog.tsx:
 *
 *   overlay: rgba(6,11,24,.4) `fade-in-0` / `fade-out-0` — 150ms CSS ease
 *   card   : `fade-in-0 zoom-in-95` / `fade-out-0 zoom-out-95 duration-150`
 *            (opacity 0↔1, scale .95↔1), kept mounted through the exit
 *   card   : glass (rgba(20,28,46,.6) + blur), radius 24, 1px white/10
 *            border, 0 24px 60px shadow, padding 24, width calc(100%−32) ≤ 420
 *   Reduce Motion: fades stay, the zoom is dropped.
 *   Native-only: the card lifts above the software keyboard.
 *
 *   <GlassDialog open={open} onRequestClose={() => setOpen(false)} dismissOnBackdrop>
 *     …
 *   </GlassDialog>
 *   (dismissOnBackdrop: Radix Dialog yes, AlertDialog no.)
 */
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { EASE } from "~/lib/motion";
import { useT } from "~/i18n";
import { GlassBackground, GLASS } from "./glass";
import { usePresenceProgress } from "./motion/presence";

export interface GlassDialogProps {
  open: boolean;
  /** Backdrop tap (if dismissOnBackdrop) / system back. */
  onRequestClose: () => void;
  /** Radix Dialog closes on overlay tap; AlertDialog doesn't. Default false. */
  dismissOnBackdrop?: boolean;
  /** Called after the exit finished and the modal unmounted. */
  onExited?: () => void;
  maxWidth?: number;
  /** Enter/exit duration (default 150). */
  duration?: number;
  /** Overlay colour (default rgba(6,11,24,.4); auth modal uses .55). */
  overlayColor?: string;
  cardStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children: ReactNode;
}

export function GlassDialog({
  open,
  onRequestClose,
  dismissOnBackdrop = false,
  onExited,
  maxWidth = 420,
  duration = 150,
  overlayColor = "rgba(6, 11, 24, 0.4)",
  cardStyle,
  accessibilityLabel,
  children,
}: GlassDialogProps) {
  const t = useT();
  const cfg = { duration, easing: EASE.css };
  const { mounted, progress } = usePresenceProgress(open, { enter: cfg, exit: cfg, onExited });

  const overlay = useAnimatedStyle(() => ({ opacity: progress.value }));
  const card = useAnimatedStyle(() => ({
    opacity: progress.value,
    // tw-animate zoom-in/out-95 is not motion-gated on the web → keep it.
    transform: [{ scale: 0.95 + 0.05 * progress.value }],
  }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onRequestClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }, overlay]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissOnBackdrop ? onRequestClose : undefined}
          accessible={dismissOnBackdrop}
          accessibilityRole={dismissOnBackdrop ? "button" : undefined}
          accessibilityLabel={dismissOnBackdrop ? t("foundation.close") : undefined}
        />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.center} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          style={[styles.card, GLASS.card, { maxWidth }, cardStyle, card]}
        >
          <GlassBackground radius={24} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  card: { width: "100%", borderRadius: 24, padding: 24 },
});
