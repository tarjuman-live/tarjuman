/**
 * UpgradeCard — src/components/billing/upgrade-card.tsx.
 *
 * A calm limit-reached nudge. The card itself mounts with no entrance (web
 * parity); only the gradient "Upgrade ›" pill moves: `transition-transform
 * active:scale-[0.98]` → 150ms bezier(.4,0,.2,1). Billing stays on the web in
 * v1, so the pill opens tarjuman.live/plans in an in-app browser (the web's
 * <Link href="/plans">). Reused by the record idle screen (recording-time
 * limit) and the session screen (summary limit). `showUpgrade={false}` drops
 * the pill when there's nothing to buy yet (Pro out of hours while Scholar is
 * "coming soon") — the message carries the reset date instead.
 */
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { API_URL } from "~/lib/config";
import { C, themed } from "~/lib/theme";
import { useT } from "~/i18n";
import { PressableScale } from "./motion/pressable-scale";

export function UpgradeCard({
  title,
  message,
  showUpgrade = true,
}: {
  title: string;
  message: string;
  showUpgrade?: boolean;
}) {
  const t = useT();
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SymbolView name="sparkles" tintColor={C.accent} size={15} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={[styles.message, !showUpgrade && { marginBottom: 0 }]}>{message}</Text>
      {showUpgrade ? (
        <PressableScale
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/plans`)}
          accessibilityRole="link"
          style={styles.pill}
        >
          <LinearGradient
            colors={[C.accent, C.accentDk]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
          />
          <Text style={styles.pillText}>{t("record.upgrade")}</Text>
          <SymbolView name="chevron.right" tintColor="#0A0F1C" size={12} weight="bold" />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: `${C.accent}30`,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  title: { color: C.w, fontSize: 14, fontWeight: "700" },
  message: { color: C.t3, fontSize: 12.5, lineHeight: 12.5 * 1.625, marginBottom: 12 },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  pillText: { color: "#0A0F1C", fontSize: 13, fontWeight: "700" },
}));
