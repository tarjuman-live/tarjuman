import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { fetch as expoFetch } from "expo/fetch";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { api } from "@convex/api";
import type { Id } from "@convex/dataModel";
import { Transcript, type TranscriptRow } from "~/components/transcript";
import { apiUrl } from "~/lib/config";
import { formatDate, formatDuration, isRtl, langName } from "~/lib/lang";
import { C, RADIUS } from "~/lib/theme";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useQuery(api.sessions.getSession, { sessionId: id });
  const saveSummary = useMutation(api.sessions.saveSummary);
  const deleteSession = useMutation(api.sessions.deleteSession);
  const authToken = useAuthToken();
  const [streaming, setStreaming] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  if (session === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  if (session === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Session not found.</Text>
      </View>
    );
  }

  // Verse/hadith merges: the parent shows the combined text, children hide.
  const hidden = new Set(session.segments.flatMap((s) => s.mergedFromIds ?? []));
  const rows: TranscriptRow[] = session.segments
    .filter((s) => !hidden.has(s.id))
    .map((s) => ({
      id: s.id,
      sourceText: s.combinedSourceText ?? s.sourceText,
      translatedText: s.combinedTranslatedText ?? s.translatedText,
    }));

  const summary = streaming ?? session.summary ?? null;
  const summaryLang = session.summaryLanguage ?? session.targetLanguage;

  const generateSummary = async () => {
    setSummaryError(null);
    setStreaming("");
    try {
      const res = await expoFetch(apiUrl("/api/summarize"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          transcript: session.segments.map((s) => s.translatedText || s.sourceText).join(" "),
          targetLanguage: session.targetLanguage,
        }),
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || type.includes("application/json")) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Summary failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setStreaming(text);
      }
      await saveSummary({
        sessionId: session._id as Id<"sessions">,
        summary: text,
        summaryLanguage: session.targetLanguage,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStreaming(null);
    } catch (e) {
      setStreaming(null);
      setSummaryError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyTranscript = async () => {
    const text = rows
      .map((r) => (r.translatedText ? `${r.sourceText}\n${r.translatedText}` : r.sourceText))
      .join("\n\n");
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmDelete = () =>
    Alert.alert("Delete this session?", "The transcript and summary are removed everywhere.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteSession({ sessionId: session._id as Id<"sessions"> });
          router.back();
        },
      },
    ]);

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{session.title || "Untitled session"}</Text>
      <Text style={styles.muted}>
        {langName(session.sourceLanguage)} → {langName(session.targetLanguage)} ·{" "}
        {formatDuration(session.duration)} · {formatDate(session.createdAt)}
      </Text>

      <View style={styles.actions}>
        <Action icon="doc.on.doc" label="Copy" onPress={copyTranscript} />
        <Action icon="trash" label="Delete" onPress={confirmDelete} destructive />
      </View>

      <View style={styles.summaryCard}>
        {summary !== null ? (
          <>
            <Text style={styles.summaryLabel}>Summary</Text>
            <Markdown text={summary || "…"} rtl={isRtl(summaryLang)} />
          </>
        ) : (
          <Pressable
            onPress={generateSummary}
            disabled={rows.length === 0}
            style={({ pressed }) => [styles.generate, pressed && { opacity: 0.85 }]}
          >
            <SymbolView name="sparkles" tintColor={C.bg} size={18} />
            <Text style={styles.generateText}>Generate summary</Text>
          </Pressable>
        )}
        {summaryError && <Text style={styles.error}>{summaryError}</Text>}
      </View>

      <Text style={styles.sectionLabel}>Transcript</Text>
    </View>
  );

  return (
    <Transcript
      rows={rows}
      sourceLanguage={session.sourceLanguage}
      targetLanguage={session.targetLanguage}
      header={header}
      empty={<Text style={styles.muted}>Nothing was transcribed in this session.</Text>}
    />
  );
}

function Action({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: "doc.on.doc" | "trash";
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const color = destructive ? C.red : C.w;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
      <SymbolView name={icon} tintColor={color} size={16} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Just enough Markdown for the summary format: headings, bullets, **bold**. */
function Markdown({ text, rtl }: { text: string; rtl: boolean }) {
  const dir = rtl ? ({ writingDirection: "rtl", textAlign: "right" } as const) : undefined;
  return (
    <View style={{ gap: 6 }}>
      {text.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        const heading = /^#{1,6}\s+/.test(line);
        const bullet = /^\s*([-*•]|\d+\.)\s+/.test(line);
        const body = line.replace(/^#{1,6}\s+/, "").replace(/^\s*([-*•])\s+/, "");
        return (
          <Text key={i} style={[heading ? styles.mdHeading : styles.mdText, dir]}>
            {bullet ? "•  " : ""}
            {body.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <Text key={j} style={{ fontWeight: "700", color: C.w }}>
                  {part.slice(2, -2)}
                </Text>
              ) : (
                part
              ),
            )}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  header: { gap: 10, marginBottom: 6 },
  title: { color: C.w, fontSize: 24, fontWeight: "700", letterSpacing: -0.3 },
  muted: { color: C.t3, fontSize: 14 },
  actions: { flexDirection: "row", gap: 8 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.surfaceLight,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  summaryCard: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: 16,
    gap: 8,
  },
  summaryLabel: { color: C.accent, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  generate: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    height: 52,
  },
  generateText: { color: C.bg, fontSize: 16, fontWeight: "700" },
  error: { color: C.red, fontSize: 14 },
  mdHeading: { color: C.w, fontSize: 17, fontWeight: "700", marginTop: 4 },
  mdText: { color: C.t2, fontSize: 16, lineHeight: 23 },
  sectionLabel: { color: C.t3, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
});
