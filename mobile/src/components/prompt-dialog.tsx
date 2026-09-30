/**
 * PromptDialog — mirror of src/components/shared/prompt-dialog.tsx (Radix
 * Dialog): overlay fade + glass card fade/zoom-95, 150ms, in AND out (see
 * GlassDialog; backdrop tap dismisses, like Radix Dialog).
 *   - input border borderLight ↔ accent on focus/blur, transition-colors
 *     150ms bezier(.4,0,.2,1); auto-focus + select-all on open;
 *   - Save: press scale .98 / 150ms; disabled:opacity-50 (instant) when
 *     empty or busy; label "Saving…" while busy;
 *   - a thrown onSave keeps it open with the error inline;
 *   - native-only: the card lifts above the keyboard.
 *
 *   <PromptDialog open={open} onOpenChange={setOpen} title="Rename session"
 *     defaultValue={title} onSave={(v) => rename(v)} />
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { C } from "~/lib/theme";
import { TW } from "~/lib/motion";

// Web `transition-colors` isn't motion-gated → never snap under Reduce Motion.
const TW_NEVER = { ...TW, reduceMotion: ReduceMotion.Never };
import { useT } from "~/i18n";
import { GlassDialog } from "./glass-dialog";
import { dialogStyles as styles } from "./confirm-dialog";
import { PressableScale } from "./motion/pressable-scale";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  saveLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
  /** Called with the trimmed value. */
  onSave: (value: string) => void | Promise<void>;
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  defaultValue = "",
  saveLabel,
  cancelLabel,
  maxLength = 120,
  onSave,
}: PromptDialogProps) {
  const t = useT();
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const focus = useSharedValue(0);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
    setError(null);
    // Web defers focus 30ms until Radix mounts the content.
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open, defaultValue]);

  const handleSave = async () => {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("foundation.somethingWrongRetry"));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));

  const disabled = busy || !value.trim();

  return (
    <GlassDialog
      open={open}
      onRequestClose={() => !busy && onOpenChange(false)}
      dismissOnBackdrop
      accessibilityLabel={title}
    >
      <Text style={[styles.title, { marginBottom: 12 }]} accessibilityRole="header">
        {title}
      </Text>
      {label ? <Text style={{ color: C.t3, fontSize: 12, marginBottom: 8 }}>{label}</Text> : null}
      <AnimatedTextInput
        ref={inputRef}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={C.t3}
        maxLength={maxLength}
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={() => void handleSave()}
        onFocus={() => {
          focus.value = withTiming(1, TW_NEVER);
        }}
        onBlur={() => {
          focus.value = withTiming(0, TW_NEVER);
        }}
        style={[
          {
            height: 40,
            paddingHorizontal: 12,
            borderRadius: 8,
            fontSize: 14,
            color: C.w,
            backgroundColor: "rgba(10, 16, 30, 0.7)",
            borderWidth: 1,
            marginBottom: 20,
          },
          inputStyle,
        ]}
      />
      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable onPress={() => onOpenChange(false)} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>{cancelLabel ?? t("foundation.cancel")}</Text>
        </Pressable>
        <PressableScale
          onPress={() => void handleSave()}
          disabled={disabled}
          disabledOpacity={0.5}
          scaleTo={0.98}
          accessibilityRole="button"
          style={[styles.confirm, { backgroundColor: C.accent }]}
        >
          <Text style={[styles.confirmText, { color: "#0A0F1C" }]}>
            {busy ? t("foundation.saving") : (saveLabel ?? t("foundation.save"))}
          </Text>
        </PressableScale>
      </View>
    </GlassDialog>
  );
}
