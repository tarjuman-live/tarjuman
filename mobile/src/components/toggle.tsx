/**
 * Toggle — mirror of src/components/settings/toggle.tsx.
 *
 *   <Toggle label="Focus on main speaker" description="…" checked={v} onChange={() => setV(!v)} />
 *     A full-width switch row: label/description + a 44×24 switch. The row's
 *     `hover:bg-black/10 transition-colors` → pressed bg rgba(0,0,0,.1), 150ms.
 *   <ToggleSwitch checked={v} />   — the bare switch (non-interactive visual).
 *
 * Switch motion (all 150ms bezier(.4,0,.2,1), not gated by Reduce Motion):
 *   track bg surfaceLight → accent, border borderLight → accent;
 *   18px knob slides left 3 → 23 (translateX 0 → 20), colour t3 → #0A0F1C.
 * Trade-off vs RN <Switch>: exact web parity instead of the 51×31 UISwitch.
 */
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { rtlRow, rtlText, useLocale } from "~/i18n";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const cfg = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

export function ToggleSwitch({ checked, style }: { checked: boolean; style?: StyleProp<ViewStyle> }) {
  const p = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(checked ? 1 : 0, cfg);
  }, [checked, p]);

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.surfaceLight, C.accent]) as string,
    borderColor: interpolateColor(p.value, [0, 1], [C.borderLight, C.accent]) as string,
  }));
  const knob = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [C.t3, "#0A0F1C"]) as string,
    transform: [{ translateX: 20 * p.value }],
  }));

  return (
    <Animated.View style={[styles.track, style, track]}>
      <Animated.View style={[styles.knob, knob]} />
    </Animated.View>
  );
}

export interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const { dir } = useLocale();
  const pressed = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pressed.value, [0, 1], ["rgba(0,0,0,0)", "rgba(0,0,0,0.1)"]) as string,
  }));

  return (
    <AnimatedPressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      disabled={disabled}
      onPress={onChange}
      onPressIn={() => {
        pressed.value = withTiming(1, cfg);
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, cfg);
      }}
      style={[styles.row, rtlRow(dir), rowStyle]}
    >
      <View style={styles.text}>
        <Text style={[styles.label, rtlText(dir)]}>{label}</Text>
        {description ? <Text style={[styles.description, rtlText(dir)]}>{description}</Text> : null}
      </View>
      <ToggleSwitch checked={checked} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  text: { flexShrink: 1, minWidth: 0 },
  label: { color: C.w, fontSize: 14, fontWeight: "600" },
  description: { color: C.t3, fontSize: 12, marginTop: 2, lineHeight: 12 * 1.375 },
  track: { width: 44, height: 24, borderRadius: 12, borderWidth: 1 },
  // Offsets are from the padding box (inside the 1px border), as in CSS:
  // left 3, vertically centred in the 22px inner height.
  knob: { position: "absolute", left: 3, top: 2, width: 18, height: 18, borderRadius: 9 },
});
