/**
 * Sign in / sign up — the web's auth popup (components/auth/auth-modal.tsx +
 * auth-form.tsx) as a transparent modal over Welcome.
 *
 * Same Convex Auth providers as the web — one account works on both.
 * Google on native: Convex returns the Google URL, iOS shows it in an
 * ASWebAuthenticationSession sheet, Google → Convex → `tarjuman://?code=…`
 * closes the sheet, and the code is exchanged for a session. The redirect is
 * allowed by the `redirect` callback in convex/auth.ts; the PKCE verifier stays
 * in this app's Keychain storage.
 *
 * Motion (web → native):
 *   - Overlay rgba(6,11,24,.55) + blur(24px): `fade-in-0` / `fade-out-0`,
 *     tw-animate default 150ms CSS ease, IN and OUT. The route is presented
 *     with `animation: "none"` (native transitionDuration does NOT apply to a
 *     modal presentation — UIKit's cross-dissolve is a fixed ~0.3s), so this
 *     screen drives the whole fade itself: one progress value 0 → 1 (150ms
 *     CSS ease) on mount; close runs it 1 → 0 and only THEN pops the route.
 *     The blur fades via BlurView `intensity` (animated prop — alpha on a
 *     UIVisualEffectView's ancestor breaks the effect), the dim via opacity.
 *   - Card: `fade-in-0 zoom-in-95` / `fade-out-0 zoom-out-95 duration-150`
 *     (CSS ease) — opacity 0 ↔ 1 AND scale .95 ↔ 1 off the same progress, so
 *     the two halves stay in lock-step in both directions. The card's glass
 *     is a FadeGlass (blur intensity + tint/frame opacity), and the content
 *     fades in its own layer — never alpha on the blur's ancestor. Reduce Motion:
 *     plays in full — tw-animate-css ships no prefers-reduced-motion rule,
 *     so the web zooms under reduce too (same as GlassDialog).
 *   - Mode flip (signIn ↔ signUp, in place): the heading block is re-keyed
 *     `animate-in fade-in duration-300`; the confirm-password field glides
 *     open/closed (grid 0fr ↔ 1fr, 300ms ease-out, opacity, margin-bottom
 *     −12 ↔ 0) — Collapsible; instant under Reduce Motion.
 *   - Inputs: `border-color 150ms ease` — borderLight → accent on focus,
 *     red@50% on a field error (error wins).
 *   - Field / form errors: the web mounts them instantly; natively they fade
 *     + glide in and out (150ms) so nothing snaps (house fluid rule).
 *   - Submit: `transition-all duration-200` — press = hover-lift −2px +
 *     brightness 110% + `active:scale-[0.98]`; busy → `disabled:opacity-60`
 *     (animated, 200ms); label "…" while submitting (web). Static glow
 *     0 0 24px accent@19%.
 *   - Google: `transition-all duration-200` — press = −2px lift, border
 *     borderLight → accent, bg surface → surfaceLight, scale .98.
 *   - ?mode=signUp opens in sign-up mode (landing CTAs).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useAuthActions } from "@convex-dev/auth/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { BlurView } from "expo-blur";
import { SymbolView } from "expo-symbols";
import Svg, { Path } from "react-native-svg";
import { C } from "~/lib/theme";
import { EASE, twEnter, type TwAnimateOptions } from "~/lib/motion";
import { rtlRow, rtlText, useLocale, type TFunction } from "~/i18n";
import { FADE_GLASS_FRAME, FadeGlass } from "~/components/account-card";
import { Collapsible, PressableScale } from "~/components/motion";

type Mode = "signIn" | "signUp";

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** `animate-in fade-in duration-300` (CSS ease) — the re-keyed heading. */
const headingEnter = twEnter({ opacity: 0, duration: 300 } satisfies TwAnimateOptions);
/** `transition-all duration-200` (Tailwind curve). */
const T200 = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
/** `border-color 150ms ease`. */
const BORDER_T = { duration: 150, easing: EASE.css, reduceMotion: ReduceMotion.Never };
/** Overlay + card `fade-*-0` / `zoom-*-95`, tw-animate default 150ms CSS ease. */
const MODAL_T = { duration: 150, easing: EASE.css, reduceMotion: ReduceMotion.Never };
/** Overlay blur(24px) ≈ expo-blur intensity 50. */
const OVERLAY_BLUR = 50;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/**
 * auth-form.tsx friendlyError, verbatim logic. Convex redacts plain auth
 * Errors to "Server Error", so that case maps to the most likely cause for the
 * current mode.
 */
function friendlyError(raw: string, mode: Mode, t: TFunction): string {
  const m = raw.toLowerCase();
  if (m.includes("server error")) {
    return mode === "signUp" ? t("settingsAuthNav.errSignUpServer") : t("settingsAuthNav.errSignInServer");
  }
  if (m.includes("invalidaccountid") || m.includes("invalidsecret") || m.includes("invalid credentials")) {
    return mode === "signIn" ? t("settingsAuthNav.errBadCredentials") : t("settingsAuthNav.errSignUpFailed");
  }
  if (m.includes("already exists") || m.includes("duplicate")) return t("settingsAuthNav.errAlreadyExists");
  if (m.includes("invalid email") || m.includes("malformed")) return t("settingsAuthNav.errInvalidEmail");
  if (m.includes("password") && m.includes("short")) {
    return t("settingsAuthNav.errPasswordShort", { n: MIN_PASSWORD });
  }
  if (m.includes("rate limit") || m.includes("too many")) return t("settingsAuthNav.errTooMany");
  if (m.includes("network") || m.includes("fetch failed")) return t("settingsAuthNav.errNetwork");
  return raw;
}

export default function SignIn() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { t, dir } = useLocale();
  const win = useWindowDimensions();

  const [mode, setMode] = useState<Mode>(params.mode === "signUp" ? "signUp" : "signIn");
  const isSignUp = mode === "signUp";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // One progress drives overlay fade, card fade and card zoom (0 = closed).
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, MODAL_T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const overlayDim = useAnimatedStyle(() => ({ opacity: p.value }));
  const overlayBlur = useAnimatedProps(() => ({ intensity: OVERLAY_BLUR * p.value }));
  // Card fade WITHOUT alpha on the glass's ancestor (that would kill the
  // UIVisualEffectView blur mid-fade): FadeGlass ramps blur intensity + fades
  // tint/frame off `p`; the content fades in its own layer (cardContent).
  const cardContent = useAnimatedStyle(() => ({ opacity: p.value }));
  const cardStyle = useAnimatedStyle(() => ({
    // tw-animate zoom-in-95 / zoom-out-95 has no prefers-reduced-motion rule
    // (and MotionConfig "user" only governs motion/react), so the web plays
    // the zoom under Reduce Motion too — as do GlassDialog / ConfirmDialog.
    transform: [{ scale: 0.95 + 0.05 * p.value }],
  }));

  // Exit: fade/zoom out fully, THEN leave the route (it has no native animation).
  const closingRef = useRef(false);
  const leave = (to: "back" | "forgot") => {
    if (closingRef.current) return;
    closingRef.current = true;
    const go = () => {
      if (to === "forgot") router.replace("/forgot-password");
      else if (router.canGoBack()) router.back();
      else router.replace("/welcome");
    };
    p.value = withTiming(0, MODAL_T, (finished) => {
      if (finished) scheduleOnRN(go);
    });
  };
  const close = () => leave("back");

  // Submit busy: disabled:opacity-60 under transition-all duration-200.
  const busyFade = useSharedValue(1);
  useEffect(() => {
    busyFade.value = withTiming(submitting ? 0.6 : 1, T200);
  }, [submitting, busyFade]);
  const busyStyle = useAnimatedStyle(() => ({ opacity: busyFade.value }));

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};
    if (!email.trim()) errs.email = t("settingsAuthNav.emailRequired");
    else if (!EMAIL_RE.test(email.trim())) errs.email = t("settingsAuthNav.emailInvalid");
    if (!password) errs.password = t("settingsAuthNav.passwordRequired");
    else if (isSignUp && password.length < MIN_PASSWORD)
      errs.password = t("settingsAuthNav.minChars", { n: MIN_PASSWORD });
    if (isSignUp && confirmPassword !== password) errs.confirmPassword = t("settingsAuthNav.mismatch");
    return errs;
  };

  const submit = async () => {
    if (submitting) return;
    setTopError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    try {
      // On success the auth gate swaps this modal for the app.
      await signIn("password", { email: email.trim(), password, flow: mode });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setTopError(friendlyError(raw, mode, t));
    } finally {
      setSubmitting(false);
    }
  };

  const google = async () => {
    if (googleBusy) return;
    setTopError(null);
    setGoogleBusy(true);
    try {
      const redirectTo = Linking.createURL("/");
      const { redirect } = await signIn("google", { redirectTo });
      if (!redirect) throw new Error("No Google redirect");
      // Ephemeral = a private cookie jar for just this sign-in. Convex Auth
      // keeps its PKCE verifier + return link in cookies between the /signin
      // hop and Google's callback; the shared-with-Safari jar dropped them on
      // iOS 27 (callback arrived cookieless → Google rejected the exchange →
      // fell back to SITE_URL). Also removes the "wants to use … to sign in"
      // prompt.
      const openedAt = Date.now();
      const result = await WebBrowser.openAuthSessionAsync(redirect.toString(), redirectTo, {
        preferEphemeralSession: true,
      });
      if (result.type !== "success") {
        // A quick close is a deliberate cancel — stay quiet. A sheet closed
        // after a real attempt means the flow never made it back to the app
        // (e.g. it fell back to the website's landing page): say so, so it
        // doesn't look like sign-in just silently did nothing.
        if (Date.now() - openedAt > 4000) setTopError(t("settingsAuthNav.googleFailed"));
        return;
      }
      const code = Linking.parse(result.url).queryParams?.code;
      if (typeof code !== "string") throw new Error("Google did not return a code");
      await signIn("google", { code });
    } catch {
      setTopError(t("settingsAuthNav.googleFailed"));
    } finally {
      setGoogleBusy(false);
    }
  };

  const switchMode = () => {
    setTopError(null);
    setFieldErrors({});
    setMode(isSignUp ? "signIn" : "signUp");
  };

  const clearError = (k: keyof FieldErrors) => {
    if (fieldErrors[k]) setFieldErrors({ ...fieldErrors, [k]: undefined });
  };

  const text = rtlText(dir);

  return (
    <View style={styles.fill}>
      {/* No native presentation animation: this screen fades itself (header). */}
      <Stack.Screen options={{ animation: "none" }} />
      {/* Overlay: dim + heavy blur so Welcome recedes. Tap = close (Radix Dialog). */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t("foundation.close")}
      >
        <AnimatedBlurView tint="dark" animatedProps={overlayBlur} style={StyleSheet.absoluteFill} />
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(6, 11, 24, 0.55)" }, overlayDim]}
        />
      </Pressable>

      <KeyboardAvoidingView behavior="padding" style={styles.center} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={[styles.card, FADE_GLASS_FRAME, { maxHeight: win.height * 0.9 }, cardStyle]}
        >
          <FadeGlass progress={p} radius={24} />
          <Animated.ScrollView
            style={cardContent}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Brand */}
            <View style={[styles.brand, rtlRow(dir)]}>
              <View style={styles.brandTile}>
                <SymbolView name="mic.fill" size={18} tintColor="#0A0F1C" />
              </View>
              <Text style={styles.brandText}>{t("settingsAuthNav.brand")}</Text>
            </View>

            <View style={styles.headAndForm}>
              {/* Heading — re-keyed on mode: fade-in 300ms. */}
              <Animated.View key={mode} entering={headingEnter}>
                <Text style={[styles.h1, text]} accessibilityRole="header">
                  {isSignUp ? t("settingsAuthNav.createTitle") : t("settingsAuthNav.welcomeBack")}
                </Text>
                <Text style={[styles.sub, text]}>
                  {isSignUp ? t("settingsAuthNav.signUpSub") : t("settingsAuthNav.signInSub")}
                </Text>
              </Animated.View>

              <View style={styles.form}>
                <Field label={t("settingsAuthNav.email")} error={fieldErrors.email} dir={dir}>
                  <AuthInput
                    error={!!fieldErrors.email}
                    value={email}
                    onChangeText={(v) => {
                      setEmail(v);
                      clearError("email");
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    // No saved-login autofill on SIGN-UP (a fresh account).
                    autoComplete={isSignUp ? "off" : "email"}
                    textContentType={isSignUp ? "none" : "username"}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    accessibilityLabel={t("settingsAuthNav.email")}
                    style={text}
                  />
                </Field>

                <Field
                  label={t("settingsAuthNav.password")}
                  error={fieldErrors.password}
                  dir={dir}
                  rightLink={
                    !isSignUp ? (
                      <Pressable onPress={() => leave("forgot")} hitSlop={8} accessibilityRole="link">
                        <Text style={styles.forgot}>{t("settingsAuthNav.forgotShort")}</Text>
                      </Pressable>
                    ) : null
                  }
                >
                  <View>
                    <AuthInput
                      inputRef={passwordRef}
                      error={!!fieldErrors.password}
                      value={password}
                      onChangeText={(v) => {
                        setPassword(v);
                        clearError("password");
                      }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete={isSignUp ? "new-password" : "current-password"}
                      textContentType={isSignUp ? "newPassword" : "password"}
                      returnKeyType={isSignUp ? "next" : "go"}
                      onSubmitEditing={() => (isSignUp ? confirmRef.current?.focus() : void submit())}
                      accessibilityLabel={t("settingsAuthNav.password")}
                      style={[{ paddingRight: 56 }, text]}
                    />
                    <Pressable
                      onPress={() => setShowPassword((s) => !s)}
                      style={styles.showBtn}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showPassword ? t("settingsAuthNav.hidePassword") : t("settingsAuthNav.showPassword")
                      }
                    >
                      <Text style={styles.showText}>
                        {showPassword ? t("settingsAuthNav.hide") : t("settingsAuthNav.show")}
                      </Text>
                    </Pressable>
                  </View>
                  {isSignUp && !fieldErrors.password ? (
                    <Text style={[styles.pwHint, text]}>{t("settingsAuthNav.minChars", { n: MIN_PASSWORD })}</Text>
                  ) : null}
                </Field>

                {/* Confirm password — always mounted, height-glides open/closed;
                    margin-bottom −12 reclaims the form's 12px gap when closed. */}
                <Collapsible open={isSignUp} fade collapsedMarginBottom={-12}>
                  <Field label={t("settingsAuthNav.confirmPassword")} error={fieldErrors.confirmPassword} dir={dir}>
                    <AuthInput
                      inputRef={confirmRef}
                      error={!!fieldErrors.confirmPassword}
                      editable={isSignUp}
                      value={confirmPassword}
                      onChangeText={(v) => {
                        setConfirmPassword(v);
                        clearError("confirmPassword");
                      }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                      returnKeyType="go"
                      onSubmitEditing={() => void submit()}
                      accessibilityLabel={t("settingsAuthNav.confirmPassword")}
                      style={text}
                    />
                  </Field>
                </Collapsible>

                <FadeMessage message={topError} collapsedMarginBottom={-12}>
                  {(msg) => (
                    <View style={styles.topError} accessibilityRole="alert">
                      <Text style={[styles.topErrorText, text]}>{msg}</Text>
                    </View>
                  )}
                </FadeMessage>

                <Animated.View style={[styles.submitWrap, busyStyle]}>
                  <PressableScale
                    onPress={() => void submit()}
                    disabled={submitting}
                    disabledOpacity={1}
                    scaleTo={0.98}
                    translateYTo={-2}
                    duration={200}
                    easing={EASE.tw}
                    pressColors={{ backgroundColor: [C.accent, "#33E07C"], duration: 200 }}
                    accessibilityRole="button"
                    accessibilityState={{ busy: submitting, disabled: submitting }}
                    style={styles.submit}
                  >
                    <Text style={styles.submitText}>
                      {submitting ? "…" : isSignUp ? t("settingsAuthNav.createAccount") : t("lp.signIn")}
                    </Text>
                  </PressableScale>
                </Animated.View>
              </View>
            </View>

            {/* or */}
            <View style={[styles.dividerRow, rtlRow(dir)]}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t("settingsAuthNav.or")}</Text>
              <View style={styles.dividerLine} />
            </View>

            <PressableScale
              onPress={() => void google()}
              disabled={googleBusy}
              disabledOpacity={1}
              scaleTo={0.98}
              translateYTo={-2}
              duration={200}
              easing={EASE.tw}
              pressColors={{
                backgroundColor: [C.surface, C.surfaceLight],
                borderColor: [C.borderLight, C.accent],
                duration: 200,
              }}
              accessibilityRole="button"
              style={[styles.google, rtlRow(dir)]}
            >
              <GoogleGlyph />
              <Text style={styles.googleText}>{t("settingsAuthNav.continueGoogle")}</Text>
            </PressableScale>

            <Text style={styles.switchLine}>
              {isSignUp ? t("settingsAuthNav.haveAccount") : t("settingsAuthNav.newTo")}
              <Text style={styles.switchLink} onPress={switchMode} accessibilityRole="button" suppressHighlighting>
                {isSignUp ? t("lp.signIn") : t("settingsAuthNav.createOne")}
              </Text>
            </Text>
          </Animated.ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Form pieces ────────────────────────────────────────────────────────────

/**
 * Keeps the last message mounted while it collapses, so an error fades +
 * glides OUT instead of vanishing (150ms, Tailwind curve).
 */
export function FadeMessage({
  message,
  children,
  collapsedMarginBottom = 0,
}: {
  message: string | null | undefined;
  children: (msg: string) => ReactNode;
  collapsedMarginBottom?: number;
}) {
  const [last, setLast] = useState(message ?? "");
  useEffect(() => {
    if (message) setLast(message);
  }, [message]);
  const shown = message || last;
  return (
    <Collapsible open={!!message} fade duration={150} easing={EASE.tw} collapsedMarginBottom={collapsedMarginBottom}>
      {shown ? children(shown) : null}
    </Collapsible>
  );
}

function Field({
  label,
  error,
  rightLink,
  dir,
  children,
}: {
  label: string;
  error?: string;
  rightLink?: ReactNode;
  dir: "ltr" | "rtl";
  children: ReactNode;
}) {
  return (
    <View>
      <View style={[styles.labelRow, rtlRow(dir)]}>
        <Text style={styles.label}>{label}</Text>
        {rightLink}
      </View>
      {children}
      <FadeMessage message={error}>
        {(msg) => (
          <Text style={[styles.fieldError, rtlText(dir)]} accessibilityRole="alert">
            {msg}
          </Text>
        )}
      </FadeMessage>
    </View>
  );
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Input whose 1px border animates `border-color 150ms ease`: rest → focus → error. */
export function AuthInput({
  error,
  inputRef,
  style,
  onFocus,
  onBlur,
  animateFocus = true,
  ...rest
}: TextInputProps & {
  error: boolean;
  inputRef?: React.RefObject<TextInput | null>;
  /** forgot-password inputs have no focus colour on the web. */
  animateFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const target = error ? `${C.red}80` : focused && animateFocus ? C.accent : C.borderLight;
  const border = useSharedValue<string>(target);
  useEffect(() => {
    border.value = withTiming(target, BORDER_T);
  }, [target, border]);
  const animated = useAnimatedStyle(() => ({ borderColor: border.value }));
  return (
    <AnimatedTextInput
      ref={inputRef}
      placeholderTextColor={C.t4}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[styles.input, style, animated]}
    />
  );
}

function GoogleGlyph() {
  return (
    <Svg width={16} height={16} viewBox="0 0 18 18">
      <Path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.84.73 3.49 1.34l2.55-2.49C13.46.86 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.94 2.28C4.6 5.05 6.62 3.48 9 3.48z"
      />
      <Path
        fill="#4285F4"
        d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <Path
        fill="#FBBC05"
        d="M3.9 10.71a5.5 5.5 0 0 1-.3-1.74c0-.6.1-1.18.29-1.74L.96 4.96A8.96 8.96 0 0 0 0 8.97c0 1.45.35 2.82.96 4.01l2.94-2.27z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"
      />
    </Svg>
  );
}

export const authStyles = StyleSheet.create({
  labelRow: { alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  label: { color: C.t4, fontSize: 11, fontWeight: "600", letterSpacing: 0.275, textTransform: "uppercase" },
  fieldError: { color: C.red, fontSize: 11, fontWeight: "600", marginTop: 4 },
  input: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 16,
    fontSize: 14,
    color: C.w,
    backgroundColor: C.surface,
    borderWidth: 1,
  },
  topError: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: `${C.red}40`,
  },
  topErrorText: { color: C.w, fontSize: 12 },
  showBtn: { position: "absolute", right: 8, top: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 8 },
  showText: { color: C.t3, fontSize: 11, fontWeight: "600" },
  submit: {
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
    boxShadow: `0 0 24px ${C.accent}30`,
  },
  submitText: { color: "#0A0F1C", fontSize: 14, fontWeight: "700" },
});

const styles = StyleSheet.create({
  ...authStyles,
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  card: { width: "100%", maxWidth: 420, borderRadius: 24, borderCurve: "continuous" },
  content: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32, gap: 24 },
  brand: { alignItems: "center", gap: 12 },
  brandTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: `0 0 30px ${C.accent}40`,
  },
  brandText: { color: C.w, fontSize: 20, fontWeight: "700" },
  headAndForm: { gap: 24 },
  h1: { color: C.w, fontSize: 24, fontWeight: "700" },
  sub: { color: C.t3, fontSize: 13, lineHeight: 13 * 1.625, marginTop: 4 },
  form: { gap: 12 },
  forgot: { color: C.accent, fontSize: 11, fontWeight: "600" },
  pwHint: { color: C.t4, fontSize: 11, marginTop: 4 },
  submitWrap: { marginTop: 8 },
  dividerRow: { alignItems: "center", gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { color: C.t4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.275 },
  google: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  googleText: { color: C.w, fontSize: 14, fontWeight: "600" },
  switchLine: { color: C.t3, fontSize: 13, textAlign: "center" },
  switchLink: { color: C.accent, fontWeight: "600" },
});
