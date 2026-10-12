/**
 * AppearancePicker — Settings → Appearance (user request 2026-10-12).
 *
 * Same "tiles on tiles" language as the language selector: a recessed tray
 * holding two raised tiles, Dark (moon) and Light (sun). The current one
 * rests lit (accent-soft bg, accent border + text + icon, soft accent glow);
 * a press lights the house outline-glow (150ms). Choosing the other mode runs
 * the app-wide switch (requestThemeMode → the root layout's fade veil).
 */
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { C, prepareThemeSwitch, requestThemeMode, themed, useThemeMode, type ThemeMode } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { rtlRow, useLocale } from "~/i18n";

const COLOR_T = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
const PRESS_T = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

export function AppearancePicker() {
  const { t, dir } = useLocale();
  const mode = useThemeMode();
  const pick = (next: ThemeMode) => {
    if (next === mode) return;
    void Haptics.selectionAsync().catch(() => {});
    requestThemeMode(next);
  };
  return (
    <View style={[styles.tray, rtlRow(dir)]} accessibilityRole="radiogroup">
      <ModeTile icon="moon.fill" label={t("settingsAuthNav.themeDark")} on={mode === "dark"} onPress={() => pick("dark")} />
      <ModeTile
        icon="sun.max.fill"
        label={t("settingsAuthNav.themeLight")}
        on={mode === "light"}
        onPress={() => pick("light")}
      />
    </View>
  );
}

function ModeTile({ icon, label, on, onPress }: { icon: SFSymbol; label: string; on: boolean; onPress: () => void }) {
  const sel = useSharedValue(on ? 1 : 0);
  const press = useSharedValue(0);
  useEffect(() => {
    sel.value = withTiming(on ? 1 : 0, COLOR_T);
  }, [on, sel]);

  const tile = useAnimatedStyle(() => {
    const lit = Math.max(sel.value, press.value);
    return {
      backgroundColor: interpolateColor(lit, [0, 1], [C.surfaceLight, C.accentSoft]) as string,
      borderColor: interpolateColor(lit, [0, 1], [C.borderLight, C.accent]) as string,
    };
  });
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [C.t2, C.accent]) as string,
  }));
  const restGlow = useAnimatedStyle(() => ({ opacity: sel.value * (1 - press.value) }));
  const hotGlow = useAnimatedStyle(() => ({ opacity: press.value }));
  const iconOn = useAnimatedStyle(() => ({ opacity: sel.value }));
  const iconOff = useAnimatedStyle(() => ({ opacity: 1 - sel.value }));

  return (
    <Pressable
      style={styles.flex}
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, PRESS_T);
        // Snapshot the screen now, so the switch starts the moment you lift.
        if (!on) prepareThemeSwitch();
      }}
      onPressOut={() => {
        press.value = withTiming(0, PRESS_T);
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.tile, tile]}>
        <Animated.View pointerEvents="none" style={[styles.glow, styles.glowRest, restGlow]} />
        <Animated.View pointerEvents="none" style={[styles.glow, styles.glowHot, hotGlow]} />
        <View style={styles.icon}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, iconOff]}>
            <SymbolView name={icon} size={20} tintColor={C.t3} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, iconOn]}>
            <SymbolView name={icon} size={20} tintColor={C.accent} />
          </Animated.View>
        </View>
        <Animated.Text style={[styles.label, text]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    // The recessed tray (language-picker card).
    tray: {
      gap: 12,
      padding: 12,
      borderRadius: 20,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
      boxShadow: "inset 0 2px 6px rgba(0, 0, 0, 0.35)",
    },
    flex: { flex: 1 },
    // A raised tile (lifted shadow + top-edge highlight); bg/border animated.
    tile: {
      alignItems: "center",
      gap: 8,
      paddingVertical: 16,
      borderRadius: 14,
      borderWidth: 1,
      boxShadow:
        "inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 1px 2px rgba(0, 0, 0, 0.45), 0 6px 14px rgba(0, 0, 0, 0.35)",
    },
    glow: { position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 15 },
    glowRest: { boxShadow: "0 0 14px rgba(46, 204, 113, 0.28)" },
    glowHot: { boxShadow: "0 0 18px rgba(46, 204, 113, 0.4)" },
    icon: { width: 24, height: 24 },
    center: { alignItems: "center", justifyContent: "center" },
    label: { fontSize: 14, fontWeight: "600" },
  })
);
