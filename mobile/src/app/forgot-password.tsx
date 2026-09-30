/**
 * Forgot password — port of src/components/auth/forgot-password-form.tsx (the
 * web /forgot-password page): Convex Auth's OTP reset flow.
 *   request: check api.users.hasPasswordAccount (so a Google-only account gets
 *            a clear message) → signIn("password", { email, flow: "reset" })
 *            emails a 6-digit code;
 *   verify : signIn("password", { email, code, newPassword,
 *            flow: "reset-verification" }) — which also signs the user in, so
 *            the auth gate usually swaps straight to the app;
 *   done   : "Password updated", then back to sign in after 1.5s (web).
 *
 * Motion (web → native): both accent submits are `transition-transform
 * active:scale-[0.98]` (150ms Tailwind curve) with a static 0 0 24px
 * accent@19% glow and an instant `disabled:opacity-60`. The web inputs here
 * have no focus colour — only the error border (red@50%), no transition —
 * and the stages swap instantly; the error messages fade/glide in and out
 * (FadeMessage, native fluid rule, same as sign-in).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useConvex } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { SymbolView } from "expo-symbols";
import { api } from "@convex/api";
import { C } from "~/lib/theme";
import { rtlRow, rtlText, useLocale, type TFunction } from "~/i18n";
import { PressableScale } from "~/components/motion";
import { AuthInput, FadeMessage, authStyles } from "./sign-in";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

type Stage = "request" | "verify" | "done";

function friendlyError(raw: string, t: TFunction): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid") && m.includes("code")) return t("settingsAuthNav.fpCodeInvalidCheck");
  if (m.includes("expired")) return t("settingsAuthNav.fpCodeExpired");
  if (m.includes("invalidaccountid") || m.includes("not found")) return t("settingsAuthNav.fpNoAccount");
  if (m.includes("rate limit") || m.includes("too many")) return t("settingsAuthNav.errTooMany");
  if (m.includes("network") || m.includes("fetch failed")) return t("settingsAuthNav.errNetwork");
  if (m.includes("resend rejected")) return t("settingsAuthNav.fpResendRejected");
  return raw;
}

/** Request step: the account was already confirmed to exist → a send/server problem. */
function requestStageError(raw: string, t: TFunction): string {
  const m = raw.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many")) return t("settingsAuthNav.errTooMany");
  if (m.includes("network") || m.includes("fetch failed")) return t("settingsAuthNav.errNetwork");
  return t("settingsAuthNav.fpSendFailed");
}

/** Verify step: unknown failures are a bad/expired code (prod redacts them). */
function verifyStageError(raw: string, t: TFunction): string {
  const m = raw.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many")) return t("settingsAuthNav.errTooMany");
  if (m.includes("network") || m.includes("fetch failed")) return t("settingsAuthNav.errNetwork");
  if (m.includes("expired")) return t("settingsAuthNav.fpCodeExpired");
  if (m.includes("invalid") || m.includes("server error") || m.includes("called by client"))
    return t("settingsAuthNav.fpCodeInvalid");
  return friendlyError(raw, t);
}

export default function ForgotPassword() {
  const { signIn } = useAuthActions();
  const convex = useConvex();
  const router = useRouter();
  const { t, dir } = useLocale();
  const text = rtlText(dir);

  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pwRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Web: "/?auth=signin" — the sign-in popup over the landing.
  const backToSignIn = () => router.replace("/sign-in");

  useEffect(() => {
    if (stage !== "done") return;
    const id = setTimeout(backToSignIn, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const requestCode = async () => {
    if (submitting) return;
    setTopError(null);
    setEmailError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError(t("settingsAuthNav.emailInvalid"));
      return;
    }
    setSubmitting(true);
    try {
      const exists = await convex.query(api.users.hasPasswordAccount, { email: email.trim() });
      if (!exists) {
        setTopError(t("settingsAuthNav.fpNoPasswordAccount"));
        return;
      }
      await signIn("password", { email: email.trim(), flow: "reset" });
      setStage("verify");
    } catch (e) {
      setTopError(requestStageError(e instanceof Error ? e.message : String(e), t));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (submitting) return;
    setTopError(null);
    setCodeError(null);
    setPwError(null);
    setConfirmError(null);
    let bad = false;
    if (!code.trim()) {
      setCodeError(t("settingsAuthNav.fpCodeRequired"));
      bad = true;
    }
    if (newPassword.length < MIN_PASSWORD) {
      setPwError(t("settingsAuthNav.minChars", { n: MIN_PASSWORD }));
      bad = true;
    }
    if (confirmPassword !== newPassword) {
      setConfirmError(t("settingsAuthNav.mismatch"));
      bad = true;
    }
    if (bad) return;
    setSubmitting(true);
    try {
      await signIn("password", {
        email: email.trim(),
        code: code.trim(),
        newPassword,
        flow: "reset-verification",
      });
      setStage("done");
    } catch (e) {
      setTopError(verifyStageError(e instanceof Error ? e.message : String(e), t));
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "done") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.doneWrap}>
          <View style={styles.doneTile}>
            <SymbolView name="checkmark" size={28} weight="semibold" tintColor={C.accent} />
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={styles.doneTitle}>{t("settingsAuthNav.fpUpdated")}</Text>
            <Text style={styles.doneSub}>{t("settingsAuthNav.fpTakingYou")}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const topErrorBox = (
    <FadeMessage message={topError} collapsedMarginBottom={-12}>
      {(msg) => (
        <View style={[authStyles.topError, { borderRadius: 8 }]} accessibilityRole="alert">
          <Text style={[authStyles.topErrorText, text]}>{msg}</Text>
        </View>
      )}
    </FadeMessage>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Pressable onPress={backToSignIn} hitSlop={8} accessibilityRole="link" style={[styles.back, rtlRow(dir)]}>
          <SymbolView name={dir === "rtl" ? "chevron.right" : "chevron.left"} size={13} weight="semibold" tintColor={C.t3} />
          <Text style={styles.backText}>{t("foundation.backToSignIn")}</Text>
        </Pressable>

        <View>
          <Text style={[styles.h1, text]} accessibilityRole="header">
            {stage === "request" ? t("foundation.forgotTitle") : t("settingsAuthNav.fpEnterCode")}
          </Text>
          <Text style={[styles.sub, text]}>
            {stage === "request" ? t("settingsAuthNav.fpRequestSub") : t("settingsAuthNav.fpVerifySub", { email })}
          </Text>
          {stage === "request" ? (
            <Text style={[styles.note, text]}>
              {t("settingsAuthNav.fpGoogleLead")}
              <Text style={styles.noteLink} onPress={backToSignIn} suppressHighlighting>
                {t("settingsAuthNav.fpGoogleLink")}
              </Text>
              {t("settingsAuthNav.fpGoogleTail")}
            </Text>
          ) : null}
        </View>

        {stage === "request" ? (
          <View style={styles.form}>
            <Field label={t("settingsAuthNav.email")} error={emailError} dir={dir}>
              <AuthInput
                animateFocus={false}
                error={!!emailError}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (emailError) setEmailError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="username"
                returnKeyType="send"
                onSubmitEditing={() => void requestCode()}
                accessibilityLabel={t("settingsAuthNav.email")}
                style={[styles.inputSquare, text]}
              />
            </Field>
            {topErrorBox}
            <SubmitButton
              label={submitting ? t("settingsAuthNav.fpSending") : t("settingsAuthNav.fpSendCode")}
              busy={submitting}
              onPress={() => void requestCode()}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <Field label={t("settingsAuthNav.fpSixDigit")} error={codeError} dir={dir}>
              <AuthInput
                animateFocus={false}
                error={!!codeError}
                value={code}
                onChangeText={(v) => {
                  setCode(v.replace(/\D/g, ""));
                  if (codeError) setCodeError(null);
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
                accessibilityLabel={t("settingsAuthNav.fpSixDigit")}
                style={[styles.inputSquare, styles.code]}
              />
            </Field>
            <Field label={t("settingsAuthNav.fpNewPassword")} error={pwError} dir={dir}>
              <View>
                <AuthInput
                  inputRef={pwRef}
                  animateFocus={false}
                  error={!!pwError}
                  value={newPassword}
                  onChangeText={(v) => {
                    setNewPassword(v);
                    if (pwError) setPwError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  accessibilityLabel={t("settingsAuthNav.fpNewPassword")}
                  style={[styles.inputSquare, { paddingRight: 56 }, text]}
                />
                <Pressable
                  onPress={() => setShowPassword((s) => !s)}
                  style={authStyles.showBtn}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? t("settingsAuthNav.hidePassword") : t("settingsAuthNav.showPassword")
                  }
                >
                  <Text style={authStyles.showText}>
                    {showPassword ? t("settingsAuthNav.hide") : t("settingsAuthNav.show")}
                  </Text>
                </Pressable>
              </View>
            </Field>
            <Field label={t("settingsAuthNav.fpConfirmNew")} error={confirmError} dir={dir}>
              <AuthInput
                inputRef={confirmRef}
                animateFocus={false}
                error={!!confirmError}
                value={confirmPassword}
                onChangeText={(v) => {
                  setConfirmPassword(v);
                  if (confirmError) setConfirmError(null);
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={() => void verifyCode()}
                accessibilityLabel={t("settingsAuthNav.fpConfirmNew")}
                style={[styles.inputSquare, text]}
              />
            </Field>
            {topErrorBox}
            <SubmitButton
              label={submitting ? t("settingsAuthNav.fpUpdating") : t("settingsAuthNav.fpUpdatePassword")}
              busy={submitting}
              onPress={() => void verifyCode()}
            />
            <Pressable
              onPress={() => {
                setStage("request");
                setCode("");
                setNewPassword("");
                setConfirmPassword("");
                setTopError(null);
              }}
              hitSlop={6}
              accessibilityRole="button"
              style={{ marginTop: 4 }}
            >
              <Text style={styles.differentEmail}>{t("settingsAuthNav.fpDifferentEmail")}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Accent submit: active:scale-[0.98] (150ms), instant disabled:opacity-60. */
function SubmitButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      disabledOpacity={0.6}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      style={[authStyles.submit, { borderRadius: 12, marginTop: 8 }]}
    >
      <Text style={authStyles.submitText}>{label}</Text>
    </PressableScale>
  );
}

function Field({
  label,
  error,
  dir,
  children,
}: {
  label: string;
  error: string | null;
  dir: "ltr" | "rtl";
  children: ReactNode;
}) {
  return (
    <View>
      <Text style={[authStyles.label, { marginBottom: 4 }, rtlText(dir)]}>{label}</Text>
      {children}
      <FadeMessage message={error}>
        {(msg) => (
          <Text style={[authStyles.fieldError, rtlText(dir)]} accessibilityRole="alert">
            {msg}
          </Text>
        )}
      </FadeMessage>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32, gap: 24 },
  back: { alignSelf: "flex-start", alignItems: "center", gap: 8 },
  backText: { color: C.t3, fontSize: 13 },
  h1: { color: C.w, fontSize: 24, fontWeight: "700" },
  sub: { color: C.t3, fontSize: 13, lineHeight: 13 * 1.625, marginTop: 4 },
  note: { color: C.t3, fontSize: 12, marginTop: 12 },
  noteLink: { color: C.accent, fontWeight: "600", textDecorationLine: "underline" },
  form: { gap: 12 },
  inputSquare: { borderRadius: 8 },
  code: {
    height: 48,
    textAlign: "center",
    fontFamily: "Menlo",
    fontSize: 18,
    letterSpacing: 9,
  },
  differentEmail: { color: C.t3, fontSize: 12, fontWeight: "600", textAlign: "center" },
  doneWrap: { flex: 1, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", gap: 16 },
  doneTile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: `${C.accent}40`,
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: { color: C.w, fontSize: 20, fontWeight: "700" },
  doneSub: { color: C.t3, fontSize: 13, marginTop: 4 },
});
