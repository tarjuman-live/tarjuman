import { FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@convex/api";
import { SessionRow } from "~/components/session-row";
import { C } from "~/lib/theme";

export default function HistoryScreen() {
  const sessions = useQuery(api.sessions.getUserSessions);
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={sessions ?? []}
        keyExtractor={(s) => s._id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.heading}>History</Text>}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => <SessionRow s={item} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {sessions === undefined
              ? "Loading…"
              : "No sessions yet. Record a khutbah or lecture and it will appear here — on this phone and on tarjuman.live."}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  heading: { color: C.w, fontSize: 28, fontWeight: "700", letterSpacing: -0.5, marginVertical: 12 },
  empty: { color: C.t3, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 48 },
});
