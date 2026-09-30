/**
 * ConfirmDialog — mirror of src/components/shared/confirm-dialog.tsx (Radix
 * AlertDialog): overlay fade + glass card fade/zoom-95, 150ms, in AND out
 * (see GlassDialog). Same props and behaviour as the web:
 *   - busy → confirm label "Working…", disabled:opacity-60 (instant — the web
 *     button only transitions transform), press scale .98 / 150ms;
 *   - a thrown onConfirm keeps the dialog open with the error inline;
 *   - cancelLabel={null} → single-action alert;
 *   - like AlertDialog, tapping the backdrop does NOT dismiss.
 *
 *   <ConfirmDialog open={open} onOpenChange={setOpen} title="Delete session?"
 *     message="…" confirmLabel="Delete" destructive onConfirm={remove} />
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "~/lib/theme";
import { useT } from "~/i18n";
import { GlassDialog } from "./glass-dialog";
import { PressableScale } from "./motion/pressable-scale";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  /** `null` hides the cancel button (alert-style single action). */
  cancelLabel?: string | null;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("foundation.somethingWrongRetry"));
    } finally {
      setBusy(false);
    }
  };

  const cancelText = cancelLabel === undefined ? t("foundation.cancel") : cancelLabel;
  const confirmBg = destructive ? C.red : C.accent;
  const confirmFg = destructive ? C.w : "#0A0F1C";

  return (
    <GlassDialog open={open} onRequestClose={() => !busy && onOpenChange(false)} accessibilityLabel={title}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {cancelText !== null ? (
          <Pressable
            onPress={() => onOpenChange(false)}
            style={styles.cancel}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>{cancelText}</Text>
          </Pressable>
        ) : null}
        <PressableScale
          onPress={() => void handleConfirm()}
          disabled={busy}
          disabledOpacity={0.6}
          scaleTo={0.98}
          accessibilityRole="button"
          style={[styles.confirm, { backgroundColor: confirmBg }]}
        >
          <Text style={[styles.confirmText, { color: confirmFg }]}>
            {busy ? t("foundation.working") : (confirmLabel ?? t("foundation.confirm"))}
          </Text>
        </PressableScale>
      </View>
    </GlassDialog>
  );
}

export const dialogStyles = StyleSheet.create({
  title: { color: C.w, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  message: { color: C.t2, fontSize: 13, lineHeight: 13 * 1.625, marginBottom: 20 },
  errorBox: {
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: `${C.red}14`,
  },
  errorText: { color: C.red, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  cancel: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: C.t2, fontSize: 13, fontWeight: "600" },
  confirm: { height: 40, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  confirmText: { fontSize: 13, fontWeight: "700" },
});
const styles = dialogStyles;
