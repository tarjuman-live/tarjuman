import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import * as WebBrowser from "expo-web-browser";
import { api } from "@convex/api";
import { API_URL } from "~/lib/config";
import { C, RADIUS } from "~/lib/theme";

export default function SettingsScreen() {
  const me = useQuery(api.users.me);
  const prefs = useQuery(api.preferences.get);
  const usage = useQuery(api.subscriptions.getMyUsageThisMonth);
  const updatePrefs = useMutation(api.preferences.update);
  const { signOut } = useAuthActions();
  const mainSpeakerOnly = prefs?.mainSpeakerOnly ?? true;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.wrap}>
        <Text style={styles.heading}>Settings</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{me?.email ?? "…"}</Text>
          {usage ? <Text style={styles.sub}>Plan: {String(usage.plan)}</Text> : null}
        </View>

        <View style={[styles.card, styles.row]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.value}>Ignore side conversations</Text>
            <Text style={styles.sub}>
              Locks onto the main speaker and drops whispers and neighbours.
            </Text>
          </View>
          <Switch
            value={mainSpeakerOnly}
            trackColor={{ true: C.accent }}
            onValueChange={(v) => void updatePrefs({ mainSpeakerOnly: v })}
          />
        </View>

        {/* Billing stays on the web in v1 — no in-app purchase yet. */}
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { borderColor: C.accent }]}
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/plans`)}
        >
          <Text style={styles.value}>Manage plan on tarjuman.live</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          onPress={() =>
            Alert.alert("Sign out?", undefined, [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void signOut() },
            ])
          }
        >
          <Text style={[styles.value, { color: C.red }]}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { paddingHorizontal: 20, gap: 12 },
  heading: { color: C.w, fontSize: 28, fontWeight: "700", letterSpacing: -0.5, marginVertical: 12 },
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 16,
    gap: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { color: C.t3, fontSize: 13 },
  value: { color: C.w, fontSize: 16, fontWeight: "600" },
  sub: { color: C.t2, fontSize: 13, lineHeight: 18 },
});
