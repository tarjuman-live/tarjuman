/**
 * RotatingText — src/components/landing/rotating-text.tsx, the hero fine
 * print's vertical slot-roll (Arabic → Urdu → Spanish → French → Turkish →
 * Indonesian).
 *
 * Web recipe, reproduced 1:1:
 *   - window: overflow-hidden, height 1.35em; column of rows each 1.35em tall
 *     (lineHeight 1.35em), plus a DUPLICATE of the first item at the end;
 *   - setInterval(2200): index += 1 → column translateY(−index·1.35em) with
 *     `transition: transform 600ms cubic-bezier(0.22, 1, 0.36, 1)`;
 *   - on reaching the duplicate (index === items.length), transitionend snaps
 *     back to 0 with the transition disabled — the loop is invisible;
 *   - the window is as wide as the widest word, words left-aligned in it;
 *   - aria-label = first item; the other rows are aria-hidden;
 *   - prefers-reduced-motion: a static first word, no interval.
 */
import { useEffect, useRef } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { EASE, useReduceMotion } from "~/lib/motion";

const LINE_EM = 1.35;
const ROLL_MS = 600;

export interface RotatingTextProps {
  items: string[];
  /** Time each word is shown (web default 2200, including the roll). */
  intervalMs?: number;
  /** Inherited font size — the rows are 1.35em of it. */
  fontSize: number;
  style?: StyleProp<TextStyle>;
}

export function RotatingText({ items, intervalMs = 2200, fontSize, style }: RotatingTextProps) {
  const reduce = useReduceMotion();
  const h = fontSize * LINE_EM;
  const y = useSharedValue(0);
  const idx = useRef(0);
  const n = items.length;
  const still = reduce || n <= 1;

  useEffect(() => {
    idx.current = 0;
    cancelAnimation(y);
    y.value = 0;
    if (still) return;
    const id = setInterval(() => {
      const next = idx.current + 1;
      // Past the duplicate the next tick starts again from row 1 (the web resets
      // its index on transitionend, long before the following tick).
      idx.current = next >= n ? 0 : next;
      y.value = withTiming(-next * h, { duration: ROLL_MS, easing: EASE.smooth, reduceMotion: ReduceMotion.Never }, (finished) => {
        "worklet";
        // Rolled onto the duplicate → snap to the real first row, no animation.
        if (finished && next >= n) y.value = 0;
      });
    }, intervalMs);
    return () => {
      clearInterval(id);
      cancelAnimation(y);
    };
  }, [still, n, h, intervalMs, y]);

  const column = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  if (still) {
    return <Text style={[style, { fontSize, lineHeight: h }]}>{items[0]}</Text>;
  }

  const list = [...items, items[0]];
  return (
    <View style={[styles.window, { height: h }]} accessible accessibilityLabel={items[0]}>
      <Animated.View style={[styles.column, column]}>
        {list.map((w, i) => (
          <Text
            key={i}
            numberOfLines={1}
            accessibilityElementsHidden={i !== 0}
            importantForAccessibility={i !== 0 ? "no-hide-descendants" : "auto"}
            style={[style, { fontSize, height: h, lineHeight: h }]}
          >
            {w}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { overflow: "hidden" },
  column: { flexDirection: "column", alignItems: "flex-start" },
});
