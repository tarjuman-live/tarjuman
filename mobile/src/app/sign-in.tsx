import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthActions } from "@convex-dev/auth/react";
import { C, RADIUS } from "~/lib/theme";

/**
 * Email + password against the same Convex Auth Password provider the web
 * uses — one account works on both. Google sign-in on native needs a
 * tarjuman:// redirect allowed by the Convex auth config; it lands in a
 * follow-up.
 */
export default function SignIn() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || password.length < 8) {
      setError("Enter your email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await signIn("password", { email: email.trim(), password, flow: mode });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(
        /InvalidSecret|InvalidAccountId|Invalid credentials/i.test(raw)
          ? "That email and password don't match."
          : /already exists/i.test(raw)
            ? "An account with this email already exists — sign in instead."
            : "Couldn't sign in. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoGlyph}>ت</Text>
          </View>
          <Text style={styles.title}>Tarjuman</Text>
          <Text style={styles.subtitle}>
            Live transcription and translation for khutbahs, lectures and classes.
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={C.t3}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={C.t3}
            secureTextEntry
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            textContentType={mode === "signUp" ? "newPassword" : "password"}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.primaryText}>
                {mode === "signIn" ? "Sign in" : "Create account"}
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setError(null);
              setMode(mode === "signIn" ? "signUp" : "signIn");
            }}
            hitSlop={12}
          >
            <Text style={styles.switch}>
              {mode === "signIn"
                ? "New to Tarjuman? Create an account"
                : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 40 },
  brand: { alignItems: "center", gap: 12 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: C.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlyph: { color: C.accent, fontSize: 38, fontWeight: "700" },
  title: { color: C.w, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { color: C.t2, fontSize: 15, textAlign: "center", lineHeight: 21 },
  form: { gap: 12 },
  input: {
    backgroundColor: C.surface,
    borderColor: C.borderLight,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    color: C.w,
    fontSize: 17,
    paddingHorizontal: 16,
    height: 54,
  },
  error: { color: C.red, fontSize: 14 },
  primary: {
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryText: { color: C.bg, fontSize: 17, fontWeight: "700" },
  switch: { color: C.t2, fontSize: 15, textAlign: "center", marginTop: 8 },
});
