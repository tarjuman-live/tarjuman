/**
 * PositioningTipsSheet — the body of src/components/recording/
 * positioning-tips.tsx, shown as a CENTRED pop-up on phone and iPad (user
 * direction 2026-09-30: "pop out smoothly in the center of the screen" — the
 * web still uses a bottom drawer here). GlassDialog pop: overlay fade + card
 * scale .92→1 over 260ms ease-out (EASE.smooth), out in 180ms; backdrop tap /
 * "Got it" close it. Tall content scrolls inside the card on small phones.
 * Content is static (no stagger), as on the web.
 *
 * "Got it": full-width accent, h-12, glow 0 0 24px accent@35,
 * `transition-transform active:scale-[0.98]` → 150ms bezier(.4,0,.2,1).
 */
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SymbolView } from "expo-symbols";
import { C } from "~/lib/theme";
import { useLocale } from "~/i18n";
import { GlassDialog } from "./glass-dialog";
import { PressableScale } from "./motion/pressable-scale";

const TIPS = [
  { icon: "1", title: "record.tip1Title", body: "record.tip1Body" },
  { icon: "2", title: "record.tip2Title", body: "record.tip2Body" },
  { icon: "3", title: "record.tip3Title", body: "record.tip3Body" },
  { icon: "4", title: "record.tip4Title", body: "record.tip4Body" },
] as const;

export function PositioningTipsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, dir } = useLocale();
  const rtl = dir === "rtl";
  const text = rtl ? ({ textAlign: "right", writingDirection: "rtl" } as const) : null;
  const row = { flexDirection: rtl ? ("row-reverse" as const) : ("row" as const) };
  const { height } = useWindowDimensions();

  return (
    <GlassDialog
      open={open}
      onRequestClose={onClose}
      dismissOnBackdrop
      maxWidth={440}
      pop={{ enterMs: 260, exitMs: 180, fromScale: 0.92 }}
      overlayColor="rgba(6, 11, 24, 0.55)"
      cardStyle={styles.card}
      accessibilityLabel={t("record.tipsTitle")}
    >
      <ScrollView
        style={{ maxHeight: height * 0.82 }}
        contentContainerStyle={styles.content}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.micTile, rtl && { alignSelf: "flex-end" }]}>
          <SymbolView name="mic.fill" tintColor={C.accent} size={22} />
        </View>
        <Text style={[styles.title, text]}>{t("record.tipsTitle")}</Text>
        <Text style={[styles.desc, text]}>{t("record.tipsIntro")}</Text>

        <View style={styles.list}>
          {TIPS.map((tip) => (
            <View key={tip.icon} style={[styles.tip, row]}>
              <View style={styles.num}>
                <Text style={styles.numText}>{tip.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tipTitle, text]}>{t(tip.title)}</Text>
                <Text style={[styles.tipBody, text]}>{t(tip.body)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.meter, row]}>
          <Text style={styles.meterDot} accessibilityElementsHidden>
            ●
          </Text>
          <Text style={[styles.meterText, text]}>{t("record.tipsMeterHint")}</Text>
        </View>

        <PressableScale onPress={onClose} accessibilityRole="button" style={styles.gotIt}>
          <Text style={styles.gotItText}>{t("record.gotIt")}</Text>
        </PressableScale>
      </ScrollView>
    </GlassDialog>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0 },
  content: { padding: 24 },
  micTile: {
    width: 48,
    height: 48,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: `${C.accent}30`,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: C.w, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  desc: { color: C.t3, fontSize: 13, lineHeight: 13 * 1.625, marginBottom: 16 },
  list: { gap: 12, marginBottom: 20 },
  tip: { gap: 12 },
  num: {
    width: 28,
    height: 28,
    borderRadius: 8,
    marginTop: 2,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  numText: { color: C.accent, fontSize: 13, fontWeight: "700" },
  tipTitle: { color: C.w, fontSize: 14, fontWeight: "600", marginBottom: 2 },
  tipBody: { color: C.t3, fontSize: 12, lineHeight: 18 },
  meter: {
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: C.amberSoft,
    borderWidth: 1,
    borderColor: `${C.amber}40`,
  },
  meterDot: { color: C.amber, fontSize: 12, lineHeight: 18 },
  meterText: { flex: 1, color: C.t2, fontSize: 12, lineHeight: 18 },
  gotIt: {
    height: 48,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 24px rgba(46,204,113,0.21)",
  },
  gotItText: { color: "#0A0F1C", fontSize: 14, fontWeight: "700" },
});
