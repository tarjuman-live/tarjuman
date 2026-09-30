/**
 * ErrorScreen — mirror of src/app/(app)/error.tsx: a red-soft 64px X tile,
 * "Something went wrong", the error message (+ optional ref), and a green
 * "Try again" button with a 0 0 24px accent@35 halo that squashes on press
 * (`transition-transform active:scale-95`, 150ms). Like the web (whose error
 * UI renders inside template.tsx), it plays the route enter on mount
 * (TW_ENTER.route — no navigation context needed, so it is safe in the root
 * ErrorBoundary).
 *
 *   <ErrorScreen error={error} onRetry={retry} />
 * Used by the root ErrorBoundary in app/_layout.tsx (works outside providers:
 * useT() falls back to English).
 */
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { C } from "~/lib/theme";
import { useT } from "~/i18n";
import { PressableScale } from "./motion/pressable-scale";
import Animated from "react-native-reanimated";
import { TW_ENTER } from "~/lib/motion";

export interface ErrorScreenProps {
  error?: (Error & { digest?: string }) | null;
  onRetry?: () => void;
}

export function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
  const t = useT();
  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View entering={TW_ENTER.route} style={styles.wrap}>
        <View style={styles.tile}>
          <SymbolView name="xmark" size={28} tintColor={C.red} weight="semibold" />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t("foundation.errorTitle")}</Text>
          <Text style={styles.message}>{error?.message || t("foundation.errorUnexpected")}</Text>
          {error?.digest ? (
            <Text style={styles.digest}>{t("foundation.errorRef", { ref: error.digest })}</Text>
          ) : null}
        </View>
        {onRetry ? (
          <PressableScale
            onPress={onRetry}
            scaleTo={0.95}
            accessibilityRole="button"
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t("foundation.tryAgain")}</Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 60, gap: 20 },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: `${C.red}30`,
  },
  copy: { alignItems: "center" },
  title: { color: C.w, fontSize: 18, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  message: { color: C.t2, fontSize: 14, lineHeight: 14 * 1.625, textAlign: "center" },
  digest: { color: C.t4, fontSize: 11, marginTop: 8, fontFamily: "Menlo" },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.accent,
    boxShadow: `0 0 24px ${C.accent}35`,
  },
  retryText: { color: "#0A0F1C", fontSize: 14, fontWeight: "700" },
});
