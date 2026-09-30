/**
 * Button — the web app's button recipes as one native primitive (built on
 * PressableScale, so every variant gets the press motion; web hover → press).
 *
 *   variant   web source                                  press / hover-as-press
 *   primary   accent CTA (Done, Generate, Save…)          hover:brightness-110 → bg #2ECC71 → #33E07C
 *   secondary completed-view Copy / New recording          border borderLight → accent, bg surface → surfaceLight (200ms)
 *   outline   transparent + borderLight (Cancel-style)      border → accent
 *   ghost     icon/kebab buttons                             bg → white/6
 *   destructive      solid red (confirm delete)              brightness-110
 *   destructiveSoft  shadcn destructive (red/20 → /30)       bg red@20% → red@30%
 *   link      text link                                      none
 *
 *   Press: scale .98 / 150ms bezier(.4,0,.2,1) (`active:scale-[0.98]`);
 *   `nudge` → shadcn `active:translate-y-px` instead; `pressScale={0.95}` for
 *   active:scale-95. Disabled: opacity .5 (instant by default; `animateDisabled`
 *   = shadcn transition-all 150ms fade). `expanded` → the house green outline
 *   glow held on (aria-expanded / its menu is open). `glow` → the static accent
 *   halo `0 0 24px accent@35` some CTAs carry. `loading` → Spinner.
 *
 *   <Button label={t("record.copy")} variant="secondary" onPress={copy} />
 *   <Button variant="primary" size="lg" loading={busy} label="Save" onPress={save} />
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { C } from "~/lib/theme";
import { PressableScale, type PressColors, type PressableScaleProps } from "./motion/pressable-scale";
import { Spinner } from "./motion/spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "destructiveSoft"
  | "link";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<PressableScaleProps, "style" | "children" | "pressColors" | "glow" | "glowActive"> {
  label?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading/trailing icon node (e.g. <SymbolView … />). */
  icon?: ReactNode;
  iconPosition?: "start" | "end";
  loading?: boolean;
  /** Static accent halo (0 0 24px accent@35). */
  glow?: boolean;
  /** Hold the green outline-glow (menu open / aria-expanded). */
  expanded?: boolean;
  /** shadcn 1px press nudge instead of the scale. */
  nudge?: boolean;
  /** Scale while pressed (default .98). */
  pressScale?: number;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const V: Record<ButtonVariant, { box: ViewStyle; text: TextStyle; press?: PressColors; spinner: string; track: string }> = {
  primary: {
    box: { backgroundColor: C.accent },
    text: { color: "#0A0F1C", fontWeight: "700" },
    press: { backgroundColor: [C.accent, "#33E07C"], duration: 200 },
    spinner: "#0A0F1C",
    track: "rgba(10,15,28,0.2)",
  },
  secondary: {
    box: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderLight },
    text: { color: C.w, fontWeight: "600" },
    press: { backgroundColor: [C.surface, C.surfaceLight], borderColor: [C.borderLight, C.accent], duration: 200 },
    spinner: C.accent,
    track: "rgba(255,255,255,0.1)",
  },
  outline: {
    box: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.borderLight },
    text: { color: C.t2, fontWeight: "600" },
    press: { borderColor: [C.borderLight, C.accent] },
    spinner: C.accent,
    track: "rgba(255,255,255,0.1)",
  },
  ghost: {
    box: { backgroundColor: "rgba(255,255,255,0)" },
    text: { color: C.t2, fontWeight: "600" },
    press: { backgroundColor: ["rgba(255,255,255,0)", "rgba(255,255,255,0.06)"] },
    spinner: C.accent,
    track: "rgba(255,255,255,0.1)",
  },
  destructive: {
    box: { backgroundColor: C.red },
    text: { color: C.w, fontWeight: "700" },
    press: { backgroundColor: [C.red, "#FF4B4B"], duration: 200 }, // brightness(1.1)
    spinner: C.w,
    track: "rgba(255,255,255,0.25)",
  },
  destructiveSoft: {
    box: { backgroundColor: `${C.red}33` },
    text: { color: C.red, fontWeight: "600" },
    press: { backgroundColor: [`${C.red}33`, `${C.red}4D`] },
    spinner: C.red,
    track: "rgba(255,255,255,0.1)",
  },
  link: {
    box: { backgroundColor: "transparent" },
    text: { color: C.accent, fontWeight: "600", textDecorationLine: "underline" },
    spinner: C.accent,
    track: "rgba(255,255,255,0.1)",
  },
};

const S: Record<ButtonSize, { box: ViewStyle; text: TextStyle; spinner: number }> = {
  sm: { box: { height: 40, paddingHorizontal: 16, borderRadius: 8 }, text: { fontSize: 13 }, spinner: 14 },
  md: { box: { height: 48, paddingHorizontal: 20, borderRadius: 12 }, text: { fontSize: 15 }, spinner: 16 },
  lg: { box: { height: 56, paddingHorizontal: 24, borderRadius: 14 }, text: { fontSize: 17 }, spinner: 20 },
};

export function Button({
  label,
  children,
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "start",
  loading = false,
  glow = false,
  expanded,
  nudge = false,
  pressScale = 0.98,
  fullWidth = false,
  style,
  textStyle,
  disabled,
  ...rest
}: ButtonProps) {
  const v = V[variant];
  const s = S[size];
  const content =
    children ??
    (label !== undefined ? (
      <Text numberOfLines={1} style={[s.text, v.text, textStyle]}>
        {label}
      </Text>
    ) : null);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || loading, busy: loading, expanded }}
      {...rest}
      disabled={disabled || loading}
      scaleTo={nudge ? 1 : pressScale}
      translateYTo={nudge ? 1 : 0}
      pressColors={v.press}
      glow={expanded !== undefined ? { borderFrom: (v.box.borderColor as string) ?? C.borderLight } : false}
      glowActive={!!expanded}
      style={[
        styles.base,
        s.box,
        v.box,
        glow && { boxShadow: `0 0 24px ${C.accent}35` },
        fullWidth && { alignSelf: "stretch" },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <Spinner size={s.spinner} color={v.spinner} track={v.track} />
        ) : (
          <>
            {icon && iconPosition === "start" ? icon : null}
            {content}
            {icon && iconPosition === "end" ? icon : null}
          </>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
