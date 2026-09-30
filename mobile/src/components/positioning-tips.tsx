/**
 * PositioningTips — first-run onboarding + re-open trigger.
 *
 * Web (positioning-tips.tsx): on the first visit to /record (no localStorage
 * ack) a mount effect opens the tips drawer; any dismissal writes the ack.
 * Native: same logic with a SecureStore ack. The web comment says users can
 * re-open the tips from the idle screen, so the idle screen also shows a small
 * "For best results" card that opens the same sheet (press: .98 / 150ms, the
 * house press recipe).
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { SymbolView } from "expo-symbols";
import { C } from "~/lib/theme";
import { useLocale } from "~/i18n";
import { PressableScale } from "./motion/pressable-scale";
import { PositioningTipsSheet } from "./positioning-tips-sheet";

/** Web key "livetranscribe:positioning-tips-ack" — SecureStore allows [A-Za-z0-9._-] only. */
const ACK_KEY = "livetranscribe.positioning-tips-ack";

function acked(): boolean {
  try {
    return !!SecureStore.getItem(ACK_KEY);
  } catch {
    return true; // keychain unavailable — don't nag on every launch
  }
}

export function PositioningTips({ showCard = true }: { showCard?: boolean }) {
  const { t, dir } = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!acked()) setOpen(true);
  }, []);

  const close = () => {
    SecureStore.setItemAsync(ACK_KEY, "1").catch(() => {});
    setOpen(false);
  };

  const rtl = dir === "rtl";
  return (
    <>
      {showCard ? (
        <PressableScale
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          style={[styles.card, { flexDirection: rtl ? "row-reverse" : "row" }]}
        >
          <View style={styles.icon}>
            <SymbolView name="mic.fill" tintColor={C.accent} size={15} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, rtl && styles.rtl]}>{t("record.tipsTitle")}</Text>
            <Text style={[styles.body, rtl && styles.rtl]} numberOfLines={2}>
              {t("record.tipsCardBody")}
            </Text>
          </View>
          <SymbolView name={rtl ? "chevron.left" : "chevron.right"} tintColor={C.t4} size={13} weight="semibold" />
        </PressableScale>
      ) : null}
      <PositioningTipsSheet open={open} onClose={close} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: `${C.accent}30`,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: C.w, fontSize: 14, fontWeight: "600", marginBottom: 2 },
  body: { color: C.t3, fontSize: 12, lineHeight: 17 },
  rtl: { textAlign: "right", writingDirection: "rtl" },
});
