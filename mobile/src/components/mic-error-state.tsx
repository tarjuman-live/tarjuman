/**
 * MicErrorState — src/components/recording/mic-error-state.tsx.
 *
 * Red mic tile + title + body + accent "Try again" (`transition-transform
 * active:scale-95` → 150ms bezier(.4,0,.2,1), static glow 0 0 24px accent@35).
 * The web's third state ("Microphone not available" — no mic exposed by the
 * browser) cannot happen natively, so only denied / generic failure exist.
 */
import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { C } from "~/lib/theme";
import { useT } from "~/i18n";
import { PressableScale } from "./motion/pressable-scale";

export function MicErrorState({
  permissionDenied,
  message,
  onRetry,
}: {
  permissionDenied: boolean;
  message: string | null;
  onRetry: () => void;
}) {
  const t = useT();
  const title = permissionDenied ? t("record.micDeniedTitle") : t("record.micFailedTitle");
  const body = permissionDenied ? t("record.micDeniedBody") : message || t("record.micFailedBody");

  return (
    <View style={styles.wrap}>
      <View style={styles.tile}>
        <SymbolView name="mic.fill" tintColor={C.red} size={28} />
      </View>
      <View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <PressableScale
        onPress={onRetry}
        scaleTo={0.95}
        accessibilityRole="button"
        style={styles.retry}
      >
        <Text style={styles.retryText}>{t("foundation.tryAgain")}</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, paddingHorizontal: 32 },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: `${C.red}30`,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: C.w, fontSize: 18, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  body: { color: C.t2, fontSize: 14, lineHeight: 14 * 1.625, textAlign: "center" },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.accent,
    boxShadow: "0 0 24px rgba(46,204,113,0.21)",
  },
  retryText: { color: "#0A0F1C", fontSize: 14, fontWeight: "700" },
});
