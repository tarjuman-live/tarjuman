import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { formatDate, formatDuration, langName } from "~/lib/lang";
import { C, RADIUS } from "~/lib/theme";

export interface SessionListItem {
  _id: string;
  title?: string;
  firstSegmentText?: string;
  sourceLanguage: string;
  targetLanguage: string;
  duration: number;
  summary?: string;
  createdAt: number;
}

export function SessionRow({ s }: { s: SessionListItem }) {
  const title = s.title || s.firstSegmentText || "Untitled session";
  return (
    <Link href={{ pathname: "/session/[id]", params: { id: s._id } }} asChild>
      <Pressable style={({ pressed }) => [styles.card, pressed && { borderColor: C.accent }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.meta}>
            {langName(s.sourceLanguage)} → {langName(s.targetLanguage)} · {formatDate(s.createdAt)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={styles.duration}>{formatDuration(s.duration)}</Text>
          {s.summary ? <Text style={styles.badge}>Summary</Text> : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 14,
  },
  title: { color: C.w, fontSize: 16, fontWeight: "600" },
  meta: { color: C.t3, fontSize: 13 },
  duration: { color: C.t2, fontSize: 14, fontVariant: ["tabular-nums"] },
  badge: {
    color: C.accent,
    backgroundColor: C.accentSoft,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
});
