/**
 * ProAiTools — port of src/components/session/pro-ai-tools.tsx: the Pro AI
 * tools under a completed / saved session (AI study notes, Ask-the-lecture,
 * full-transcript translation into any language). Ephemeral — results live in
 * local state, not persisted (v1, same as the web).
 *
 * Gating (identical to the web and to the /api/study-notes|ask|
 * translate-transcript server gates): locked only when billing is LIVE and
 * the plan isn't "pro" — while BILLING_ENABLED is false everyone can use them,
 * clearly marked ✦ Pro. Locked → the UpgradeCard teaser; "Upgrade" opens
 * tarjuman.live/plans in an in-app browser (no in-app purchase in v1).
 *
 * Motion:
 *   - segmented tabs: `transition-all duration-200` → the active pill's
 *     background (transparent → accent) and label colour (t2 → ink) cross-fade
 *     over 200ms bezier(.4,0,.2,1), both directions. Panels swap instantly,
 *     like the web's conditional render.
 *   - Upgrade link: `transition-transform active:scale-[0.98]` (150ms tw).
 *   - Study notes / Translate / Ask motion: see study-notes.tsx, ask-lecture.tsx
 *     and lang-dropdown.tsx.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "convex/react";
import { api } from "@convex/api";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { API_URL } from "~/lib/config";
import { rtlRow, rtlText, useLocale, type TKey } from "~/i18n";
import { BILLING_ENABLED } from "../../../convex/billingLimits";
import { PressableScale } from "./motion/pressable-scale";
import { AskLecture } from "./ask-lecture";
import { CssGradient135, StudyNotes, TranslateTranscript } from "./study-notes";

export interface ProAiToolsProps {
  sessionId: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: { id: string; sourceText: string; translatedText: string }[];
}

type Tab = "notes" | "ask" | "translate";

const TABS: [Tab, TKey][] = [
  ["notes", "proTools.tabNotes"],
  ["ask", "proTools.tabAsk"],
  ["translate", "proTools.tabTranslate"],
];

const INK = "#0A0F1C";

export function ProAiTools({
  sourceLanguage,
  targetLanguage,
  segments,
}: ProAiToolsProps): ReactElement | null {
  const { t, dir } = useLocale();
  const plan = useQuery(api.subscriptions.getMyUsageThisMonth, {});
  const [tab, setTab] = useState<Tab>("notes");

  const locked = BILLING_ENABLED && plan?.plan !== "pro";
  if (segments.length === 0) return null;

  // Content the LLM reasons over (target/English translation, like the summary).
  const transcriptForLLM = segments.map((s) => s.translatedText || s.sourceText).join(" ");
  // Original speech, for re-translating the whole lecture into a new language.
  const sourceTranscript = segments.map((s) => s.sourceText).join(" ");

  return (
    <View style={styles.card}>
      <View style={[styles.header, rtlRow(dir)]}>
        <SymbolView name="sparkle" tintColor={C.accent} size={14} />
        <Text style={styles.eyebrow}>{t("proTools.aiTools")}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t("proTools.proBadge")}</Text>
        </View>
      </View>

      {locked ? (
        <UpgradeCard title={t("proTools.lockedTitle")} message={t("proTools.lockedMessage")} />
      ) : (
        <>
          <View style={[styles.tabs, rtlRow(dir)]} accessibilityRole="tablist">
            {TABS.map(([id, key]) => (
              <TabButton key={id} label={t(key)} active={tab === id} onPress={() => setTab(id)} />
            ))}
          </View>

          {tab === "notes" ? (
            <StudyNotes transcript={transcriptForLLM} targetLang={targetLanguage} />
          ) : null}
          {tab === "ask" ? <AskLecture transcript={transcriptForLLM} targetLang={targetLanguage} /> : null}
          {tab === "translate" ? (
            <TranslateTranscript
              transcript={sourceTranscript}
              sourceLang={sourceLanguage}
              targetLang={targetLanguage}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

/** flex-1 h-8 rounded-lg 12.5px bold, `transition-all duration-200`. */
function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const p = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(active ? 1 : 0, {
      duration: 200,
      easing: EASE.tw,
      reduceMotion: ReduceMotion.Never,
    });
  }, [active, p]);

  const bg = useAnimatedStyle(() => ({
    // transparent is interpolated as accent@0 (CSS premultiplied) — no grey dip.
    backgroundColor: interpolateColor(p.value, [0, 1], ["rgba(46,204,113,0)", C.accent]) as string,
  }));
  const fg = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.t2, INK]) as string,
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.tabHit}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={[styles.tab, bg]}>
        <Animated.Text style={[styles.tabText, fg]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * billing/upgrade-card.tsx — the calm Pro nudge. Its "Upgrade" link routes to
 * /plans; natively that opens tarjuman.live/plans in an in-app browser.
 */
function UpgradeCard({ title, message }: { title: string; message: string }) {
  const { t, dir } = useLocale();
  return (
    <View style={styles.upgrade}>
      <View style={[styles.upgradeHead, rtlRow(dir)]}>
        <SymbolView name="sparkle" tintColor={C.accent} size={15} />
        <Text style={[styles.upgradeTitle, rtlText(dir)]}>{title}</Text>
      </View>
      <Text style={[styles.upgradeMsg, rtlText(dir)]}>{message}</Text>
      <PressableScale
        onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/plans`).catch(() => {})}
        accessibilityRole="link"
        style={[styles.upgradeBtn, rtlRow(dir), { alignSelf: dir === "rtl" ? "flex-end" : "flex-start" }]}
      >
        <View pointerEvents="none" style={styles.upgradeFill}>
          <CssGradient135 colors={[C.accent, C.accentDk]} />
        </View>
        <Text style={styles.upgradeBtnText}>{t("proTools.upgrade")}</Text>
        <SymbolView
          name={dir === "rtl" ? "chevron.left" : "chevron.right"}
          tintColor={INK}
          size={12}
          weight="bold"
        />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  // px-4 py-4 rounded-2xl mb-5, surface, 1px accent@30
  card: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: "rgba(46,204,113,0.19)",
  },
  header: { alignItems: "center", gap: 8, marginBottom: 12 },
  eyebrow: {
    color: C.accent,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.55,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: C.accentSoft,
  },
  badgeText: {
    color: C.accent,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.45,
  },
  // flex gap-1 p-1 rounded-xl mb-4, bg / border
  tabs: {
    gap: 4,
    padding: 4,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabHit: { flex: 1 },
  tab: { height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tabText: { fontSize: 12.5, fontWeight: "700" },
  // UpgradeCard: rounded-2xl px-4 py-4, surface, accent@30 border
  upgrade: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: "rgba(46,204,113,0.19)",
  },
  upgradeHead: { alignItems: "center", gap: 8, marginBottom: 6 },
  upgradeTitle: { color: C.w, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  upgradeMsg: { color: C.t3, fontSize: 12.5, lineHeight: 20, marginBottom: 12 },
  // inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl 13px bold
  upgradeBtn: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  upgradeFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, overflow: "hidden" },
  upgradeBtnText: { color: INK, fontSize: 13, fontWeight: "700" },
});
