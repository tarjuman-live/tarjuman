/**
 * Liquid-glass material — the web's `.glass-panel` / glass modal card:
 *   background rgba(20,28,46,0.6); backdrop-filter blur(28px) saturate(180%);
 *   1px rgba(255,255,255,0.1) border; 0 24px 60px rgba(0,0,0,.5) drop shadow
 *   + inset top catch-light / bottom shade.
 *
 *   <View style={[GLASS.card, { borderRadius: 24 }]}>
 *     <GlassBackground radius={24} />          // absolute blur + tint + highlights
 *     …content…
 *   </View>
 *
 * The drop shadow (GLASS.shadow) belongs on the OUTER view (no overflow
 * hidden there); GlassBackground clips itself to the radius.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

export const GLASS = {
  tint: "rgba(20, 28, 46, 0.6)",
  border: "rgba(255, 255, 255, 0.1)",
  shadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  /** Outer container defaults (border + shadow). */
  card: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  } satisfies ViewStyle,
} as const;

export interface GlassBackgroundProps {
  /** Uniform radius, or per-corner via style. */
  radius?: number;
  /** Only round the top corners (bottom sheets). */
  topOnly?: boolean;
  /** expo-blur intensity (default 60 ≈ 28px CSS blur on the dark tint). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}

export function GlassBackground({ radius = 24, topOnly = false, intensity = 60, style }: GlassBackgroundProps) {
  const corners: ViewStyle = topOnly
    ? { borderTopLeftRadius: radius, borderTopRightRadius: radius }
    : { borderRadius: radius };
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, corners, { overflow: "hidden" }, style]}>
      <BlurView tint="dark" intensity={intensity} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: GLASS.tint }]} />
      {/* inset 0 1px 0 rgba(255,255,255,.12) / inset 0 -1px 0 rgba(0,0,0,.25) */}
      <View style={[StyleSheet.absoluteFill, corners, { boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.25)" }]} />
    </View>
  );
}
