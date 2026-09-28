import { StyleSheet, Text, View } from "react-native";
import { C } from "~/lib/theme";

const BARS = 12;
/** Below this (processed RMS × 8) the phone isn't hearing the speaker well. */
const TOO_QUIET = 0.04;

/**
 * Functional, not decorative (CLAUDE.md #12): real signal level, and a
 * "move closer" prompt so nobody sits through 30 minutes of a lecture only to
 * find the transcript is empty.
 */
export function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const lit = Math.round(Math.min(1, level * 1.6) * BARS);
  const quiet = active && level < TOO_QUIET;
  return (
    <View style={styles.wrap} accessibilityLabel={quiet ? "Signal too quiet" : "Signal level"}>
      <View style={styles.bars}>
        {Array.from({ length: BARS }, (_, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: 6 + i * 1.5 },
              i < lit && active && { backgroundColor: quiet ? C.amber : C.accent },
            ]}
          />
        ))}
      </View>
      {quiet && <Text style={styles.hint}>Too quiet — move closer to the speaker</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 24 },
  bar: { width: 4, borderRadius: 2, backgroundColor: C.surfaceLight },
  hint: { color: C.amber, fontSize: 13, fontWeight: "600" },
});
