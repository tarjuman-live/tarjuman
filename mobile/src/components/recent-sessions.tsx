/**
 * RecentSessions — src/components/recording/recent-sessions-preview.tsx.
 *
 * The last 3 sessions under the record button. Loading and empty render
 * nothing (keeps the idle screen quiet). The web rows carry `transition-colors`
 * but no hover colour, so there is no motion to port — the tap just pushes the
 * session screen (native stack push).
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "convex/react";
import { SymbolView } from "expo-symbols";
import { api } from "@convex/api";
import { formatDate, formatDuration, langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { useLocale } from "~/i18n";

export function RecentSessions() {
  const router = useRouter();
  const { t, dir } = useLocale();
  const sessions = useQuery(api.sessions.getRecentSessions, { limit: 3 });
  if (!sessions || sessions.length === 0) return null;

  return (
    <View>
      <Text style={[styles.label, dir === "rtl" && { textAlign: "right" }]}>{t("record.recent")}</Text>
      {sessions.map((s) => {
        const title = s.title || s.firstSegmentText || t("record.untitled");
        return (
          <Pressable
            key={s._id}
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: s._id } })}
            accessibilityRole="link"
            style={[styles.row, { flexDirection: dir === "rtl" ? "row-reverse" : "row" }]}
          >
            <View style={styles.icon}>
              <SymbolView name="doc.text" tintColor={C.t3} size={16} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {langName(s.sourceLanguage)} → {langName(s.targetLanguage)} · {formatDate(s.createdAt)}
              </Text>
            </View>
            <Text style={styles.duration}>{formatDuration(s.duration)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: C.t3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.88,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  row: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    marginBottom: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0 },
  title: { color: C.w, fontSize: 14, fontWeight: "600", marginBottom: 2 },
  meta: { color: C.t4, fontSize: 11 },
  duration: { color: C.t3, fontSize: 12, fontVariant: ["tabular-nums"] },
});
