/**
 * Skeleton — mirror of src/components/shared/skeleton.tsx: a surfaceLight
 * block (radius 10) that animate-pulses (2s, 1 → .5 → 1) while data loads.
 * All mounted skeletons share ONE pulse clock, so they breathe in sync (on
 * the web they sync by mounting on the same frame). The skeleton → content
 * swap is instant on the web; do not add a crossfade.
 *
 *   <Skeleton style={{ width: "55%", height: 14 }} />
 *   <Skeleton style={{ width: 36, height: 36 }} rounded={8} />
 *   <HeaderSkeleton />   <SegmentSkeleton widths={["90%", "70%"]} />
 */
import { useEffect } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, makeMutable, useAnimatedStyle } from "react-native-reanimated";
import { C } from "~/lib/theme";
import { startPulse } from "./pulse";

const CLOCK = makeMutable(1);
let users = 0;

function useSharedPulse() {
  useEffect(() => {
    users += 1;
    if (users === 1) startPulse(CLOCK);
    return () => {
      users -= 1;
      if (users === 0) {
        cancelAnimation(CLOCK);
        CLOCK.value = 1;
      }
    };
  }, []);
  return useAnimatedStyle(() => ({ opacity: CLOCK.value }));
}

export function Skeleton({ style, rounded = 10 }: { style?: StyleProp<ViewStyle>; rounded?: number }) {
  const pulse = useSharedPulse();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ backgroundColor: C.surfaceLight, borderRadius: rounded }, style, pulse]}
    />
  );
}

/** Header row (back-button square + title/subtitle bars) used by detail pages. */
export function HeaderSkeleton() {
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingVertical: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <Skeleton style={{ width: 36, height: 36 }} rounded={8} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton style={{ width: "55%", height: 14 }} />
        <Skeleton style={{ width: 60, height: 10 }} />
      </View>
    </View>
  );
}

/** A stacked source-card + translation-card pair, matching a transcript segment. */
export function SegmentSkeleton({ widths = ["90%", "70%"] }: { widths?: [DimensionValue, DimensionValue] }) {
  return (
    <View style={{ marginBottom: 16, gap: 6 }}>
      <Skeleton style={{ width: widths[0], height: 52 }} rounded={16} />
      <Skeleton style={{ width: widths[1], height: 44 }} rounded={16} />
    </View>
  );
}
