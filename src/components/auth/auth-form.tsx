"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

interface AuthFormProps {
  mode: "signIn" | "signUp";
  /**
   * When provided, the sign-in/sign-up toggle switches mode in place (calling
   * this) instead of navigating to /login or /signup. Used by the auth modal
   * so the popup flips between modes without a page change. Omit on the
   * standalone /login and /signup pages to keep link navigation.
   */
  onSwitchMode?: (next: "signIn" | "signUp") => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/**
 * How the user proves who they are: a password, or a 6-digit code emailed to
 * them (Convex provider "email-code", convex/emailCode.ts). Offered on both
 * sign-up and sign-in — whoever signs up with a code signs back in with one.
 */
type Method = "password" | "code";
const METHOD_KEY = "tarjuman:auth-method";
const EMAIL_CODE_PROVIDER = "email-code";
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;

/** `code` from a ConvexError thrown on purpose by our auth callbacks. */
function convexErrorCode(e: unknown): string | undefined {
  if (!(e instanceof ConvexError)) return undefined;
  const data: unknown = e.data;
  return typeof data === "object" && data !== null && "code" in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

function isNetworkError(raw: string): boolean {
  const m = raw.toLowerCase();
  return m.includes("network") || m.includes("fetch failed");
}

/** Errors from the "email me a code" step. */
function sendCodeError(e: unknown): string {
  if (convexErrorCode(e) === "too_many_codes")
    return "Too many codes sent to this email. Wait 15 minutes, then try again.";
  const raw = e instanceof Error ? e.message : String(e);
  if (isNetworkError(raw))
    return "Couldn't reach the server. Check your connection and try again.";
  return "Couldn't send a code right now. Please try again in a moment.";
}

/**
 * Errors from the "enter the code" step. Convex Auth reports a wrong, expired
 * or rate-limited code as a plain error ("Could not verify code"), which
 * production redacts to "Server Error" — so anything that isn't a network
 * problem reads as a bad code.
 */
function verifyCodeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (isNetworkError(raw))
    return "Couldn't reach the server. Check your connection and try again.";
  return "That code is invalid or expired. Check the latest email, or send a new code.";
}

/**
 * Maps the raw error message from Convex Auth / Auth.js into a sentence the
 * user can act on.
 *
 * Critical context: @convex-dev/auth throws plain `Error(...)` (NOT
 * ConvexError) for every failure — "Account X already exists",
 * "InvalidSecret", "InvalidAccountId", etc. Convex's server redacts plain
 * Error messages to literal "Server Error" before they reach the browser.
 * So the underlying-cause strings (`already exists`, `invalid credentials`,
 * etc.) NEVER appear in `raw` for auth failures — only the redacted
 * "Server Error". The Convex deployment logs still hold the real error
 * for postmortem.
 *
 * We therefore translate "Server Error" into the most-likely cause for the
 * current form mode. Not deterministic, but actionable.
 */
function friendlyError(raw: string, mode: "signIn" | "signUp"): string {
  const m = raw.toLowerCase();

  // Convex's redacted "Server Error" surface — by far the most common
  // path for auth failures since the library throws plain Error.
  if (m.includes("server error")) {
    return mode === "signUp"
      ? "Couldn't create your account. The email may already be registered — try signing in instead, or use a different email."
      : "Couldn't sign in. Check your email and password, then try again. If you don't have an account yet, sign up first.";
  }

  // The cases below are kept for the rare situations where Convex Auth
  // returns a friendly error (e.g., explicit ConvexError thrown by an
  // OAuth provider) or for client-side network errors.
  if (m.includes("invalidaccountid") || m.includes("invalid credentials")) {
    return mode === "signIn"
      ? "Email or password is incorrect."
      : "Could not create account. Try again or use Google sign-in.";
  }
  if (m.includes("already exists") || m.includes("duplicate")) {
    return "An account with that email already exists. Sign in instead.";
  }
  if (m.includes("invalid email") || m.includes("malformed")) {
    return "That email address doesn't look valid.";
  }
  if (m.includes("password") && m.includes("short")) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (m.includes("network") || m.includes("fetch failed")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return raw;
}

export function AuthForm({ mode, onSwitchMode }: AuthFormProps) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const isSignUp = mode === "signUp";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<
    "email" | "password" | "confirmPassword" | "code" | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // "created" = password sign-up; "in" = email-code sign-up (the code flow
  // can't tell a new account from a returning one, so it doesn't claim either).
  const [success, setSuccess] = useState<"created" | "in" | null>(null);

  const [method, setMethod] = useState<Method>(() => {
    if (typeof window === "undefined") return "password";
    try {
      return localStorage.getItem(METHOD_KEY) === "code" ? "code" : "password";
    } catch {
      return "password";
    }
  });
  // Email-code flow: "email" = asking for the address, "code" = code sent.
  const [codeStage, setCodeStage] = useState<"email" | "code">("email");
  const [codeSentTo, setCodeSentTo] = useState("");
  const [code, setCode] = useState("");
  const [codeNotice, setCodeNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const usingCode = method === "code";
  const awaitingCode = usingCode && codeStage === "code";

  // After a successful signup, hold on the success state for ~1.2s so the
  // user sees the confirmation, then route forward. /start sends operators
  // (ADMIN_USER_IDS) to /admin and everyone else to /record.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => router.push("/start"), 1200);
    return () => clearTimeout(t);
  }, [success, router]);

  // Resend cooldown, ticking once a second while it runs.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Once the code is sent, put the cursor in the code field.
  useEffect(() => {
    if (awaitingCode) codeInputRef.current?.focus({ preventScroll: true });
  }, [awaitingCode]);

  const switchMethod = (next: Method) => {
    if (next === method) return;
    setMethod(next);
    setTopError(null);
    setFieldErrors({});
    try {
      localStorage.setItem(METHOD_KEY, next);
    } catch {
      // Private mode / storage full — remembering the choice is a nicety.
    }
  };

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};
    if (!email.trim()) errs.email = "Email is required.";
    else if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email.";
    if (!password) errs.password = "Password is required.";
    else if (isSignUp && password.length < MIN_PASSWORD)
      errs.password = `At least ${MIN_PASSWORD} characters.`;
    if (isSignUp && confirmPassword !== password)
      errs.confirmPassword = "Passwords don't match.";
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      await signIn("password", {
        email: email.trim(),
        password,
        flow: isSignUp ? "signUp" : "signIn",
      });
      if (isSignUp) {
        setSuccess("created");
      } else {
        router.push("/start");
      }
    } catch (e) {
      if (convexErrorCode(e) === "email_in_use") {
        setTopError(
          "This email already has an account. Sign in with an email code or Google instead."
        );
        return;
      }
      const raw = e instanceof Error ? e.message : String(e);
      setTopError(friendlyError(raw, mode));
    } finally {
      setSubmitting(false);
    }
  };

  /** Emails a code to `address` (already validated + normalized). */
  const sendCode = async (address: string) => {
    setTopError(null);
    setSubmitting(true);
    try {
      await signIn(EMAIL_CODE_PROVIDER, { email: address });
      setCodeSentTo(address);
      setCode("");
      setCodeStage("code");
      setResendIn(RESEND_COOLDOWN_S);
      return true;
    } catch (e) {
      setTopError(sendCodeError(e));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCode = async () => {
    // Trim + lowercase: the send and the verify must use the identical string,
    // and one address shouldn't become two accounts by capitalization.
    const address = email.trim().toLowerCase();
    if (!address) {
      setFieldErrors({ email: "Email is required." });
      return;
    }
    if (!EMAIL_RE.test(address)) {
      setFieldErrors({ email: "Enter a valid email." });
      return;
    }
    setFieldErrors({});
    setCodeNotice(null);
    await sendCode(address);
  };

  const handleResend = async () => {
    if (resendIn > 0 || submitting) return;
    setCodeNotice(null);
    if (await sendCode(codeSentTo)) setCodeNotice("New code sent.");
  };

  const handleVerify = async (value: string) => {
    if (submitting) return;
    if (value.length !== CODE_LENGTH) {
      setTopError(`Enter the ${CODE_LENGTH}-digit code from the email.`);
      return;
    }
    setTopError(null);
    setCodeNotice(null);
    setSubmitting(true);
    try {
      const { signingIn } = await signIn(EMAIL_CODE_PROVIDER, {
        email: codeSentTo,
        code: value,
      });
      if (!signingIn) {
        setTopError(verifyCodeError(null));
        setCode("");
        return;
      }
      if (isSignUp) setSuccess("in");
      else router.push("/start");
    } catch (e) {
      setTopError(verifyCodeError(e));
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  const changeEmail = () => {
    setCodeStage("email");
    setCode("");
    setCodeNotice(null);
    setTopError(null);
    setResendIn(0);
    emailInputRef.current?.focus({ preventScroll: true });
  };

  const onFormSubmit = (e: React.FormEvent) => {
    if (!usingCode) return handleSubmit(e);
    e.preventDefault();
    if (awaitingCode) void handleVerify(code);
    else void handleSendCode();
  };

  const handleGoogle = async () => {
    setTopError(null);
    try {
      await signIn("google", { redirectTo: "/start" });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setTopError(friendlyError(raw, mode));
    }
  };

  if (success) {
    return (
      <div className="flex flex-col flex-1 px-6 pt-12 pb-8 items-center justify-center text-center gap-4">
        <div
          className="w-16 h-16 rounded-2xl grid place-items-center"
          style={{
            background: COLORS.accentSoft,
            border: `1px solid ${COLORS.accent}40`,
          }}
        >
          <Icon name="check" size={28} color={COLORS.accent} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: COLORS.w }}>
            {success === "created" ? "Account created" : "You're in"}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: COLORS.t3 }}>
            Welcome to Tarjuman. Taking you to the recorder…
          </p>
        </div>
      </div>
    );
  }

  const submitLabel = usingCode
    ? awaitingCode
      ? "Verify code"
      : "Send 6-digit code"
    : isSignUp
      ? "Create account"
      : "Sign in";

  return (
    <div className="flex flex-col flex-1 px-6 pt-12 pb-8 gap-6">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl grid place-items-center"
          style={{
            background: COLORS.accent,
            boxShadow: `0 0 30px ${COLORS.accent}40`,
          }}
        >
          <Icon name="mic" size={18} color="#0A0F1C" />
        </div>
        <span className="text-xl font-bold" style={{ color: COLORS.w }}>
          Tarjuman
        </span>
      </div>

      {/* Heading + form stay mounted; only the heading text crossfades on mode
          flip, and fields that come and go (confirm password, the password
          fields vs the email-code steps) animate their height via <Collapse> —
          so every switch is smooth instead of a hard swap. */}
      <div className="flex flex-col gap-6">
      <div key={mode} className="animate-in fade-in duration-300">
        <h1 className="text-2xl font-bold" style={{ color: COLORS.w }}>
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p
          className="text-[13px] mt-1 leading-relaxed"
          style={{ color: COLORS.t3 }}
        >
          {isSignUp
            ? "Sign up to save your transcripts across devices."
            : "Sign in to access your transcript history and continue where you left off."}
        </p>
      </div>

      <form onSubmit={onFormSubmit} className="flex flex-col gap-3" noValidate>
        <MethodTabs value={method} onChange={switchMethod} />

        <Collapse open={!awaitingCode}>
          <Field
            label="Email"
            error={fieldErrors.email}
          >
            <input
              ref={emailInputRef}
              type="email"
              inputMode="email"
              // Don't let the browser autofill a saved login on the SIGN-UP form
              // (it should be a fresh account); keep autofill on sign-in.
              autoComplete={isSignUp ? "off" : "email"}
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email)
                  setFieldErrors({ ...fieldErrors, email: undefined });
              }}
              onFocus={() => setFocused("email")}
              onBlur={() => setFocused(null)}
              className="w-full h-11 px-3 rounded-2xl outline-none text-[14px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  fieldErrors.email
                    ? `${COLORS.red}80`
                    : focused === "email"
                      ? COLORS.accent
                      : COLORS.borderLight
                }`,
                color: COLORS.w,
                transition: "border-color 150ms ease",
              }}
            />
          </Field>
        </Collapse>

        {/* Email-code step 2: the code itself. */}
        <Collapse open={awaitingCode}>
          <div className="flex flex-col gap-3">
            <p
              className="text-[13px] leading-relaxed"
              style={{ color: COLORS.t3 }}
              aria-live="polite"
            >
              We sent a 6-digit code to{" "}
              <span className="font-semibold break-all" style={{ color: COLORS.w }}>
                {codeSentTo}
              </span>
              . It expires in 15 minutes — check spam if it isn&apos;t there.
              {codeNotice && (
                <span
                  key={codeNotice + resendIn}
                  className="animate-in fade-in duration-300 font-semibold"
                  style={{ color: COLORS.accent }}
                >
                  {" "}
                  {codeNotice}
                </span>
              )}
            </p>
            <Field label="6-digit code">
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                // No maxLength: a pasted "123 456" must reach onChange whole
                // so the digits survive; the handler trims to 6.
                value={code}
                onChange={(e) => {
                  const digits = e.target.value
                    .replace(/\D/g, "")
                    .slice(0, CODE_LENGTH);
                  setCode(digits);
                  if (topError) setTopError(null);
                  if (digits.length === CODE_LENGTH) void handleVerify(digits);
                }}
                onFocus={() => setFocused("code")}
                onBlur={() => setFocused(null)}
                placeholder="••••••"
                className="w-full h-14 rounded-2xl outline-none text-[24px] font-bold text-center tabular-nums tracking-[0.5em]"
                style={{
                  // Letter-spacing also trails the last digit; pad the left
                  // by the same 0.5em so the group stays visually centered.
                  paddingLeft: "calc(0.75rem + 0.5em)",
                  paddingRight: "0.75rem",
                  background: COLORS.surface,
                  border: `1px solid ${
                    focused === "code" ? COLORS.accent : COLORS.borderLight
                  }`,
                  color: COLORS.w,
                  transition: "border-color 150ms ease",
                }}
              />
            </Field>
            <div className="flex items-center justify-between gap-3 text-[12px] font-semibold">
              <button
                type="button"
                onClick={changeEmail}
                className="cursor-pointer transition-colors duration-200 hover:text-[var(--color-accent)]"
                style={{ color: COLORS.t3 }}
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendIn > 0 || submitting}
                className="cursor-pointer tabular-nums transition-opacity duration-200 disabled:cursor-default disabled:opacity-50"
                style={{ color: COLORS.accent }}
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </div>
        </Collapse>

        <Collapse open={!usingCode}>
          <Field
            label="Password"
            error={fieldErrors.password}
            rightLink={
              !isSignUp && (
                <Link
                  href="/forgot-password"
                  className="text-[11px] font-semibold"
                  style={{ color: COLORS.accent }}
                >
                  Forgot?
                </Link>
              )
            }
          >
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={isSignUp ? MIN_PASSWORD : 1}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password)
                    setFieldErrors({ ...fieldErrors, password: undefined });
                }}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                className="w-full h-11 pl-3 pr-12 rounded-2xl outline-none text-[14px]"
                style={{
                  background: COLORS.surface,
                  border: `1px solid ${
                    fieldErrors.password
                      ? `${COLORS.red}80`
                      : focused === "password"
                        ? COLORS.accent
                        : COLORS.borderLight
                  }`,
                  color: COLORS.w,
                  transition: "border-color 150ms ease",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-semibold cursor-pointer"
                style={{ color: COLORS.t3 }}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {isSignUp && !fieldErrors.password && (
              <p className="text-[11px] mt-1" style={{ color: COLORS.t4 }}>
                At least {MIN_PASSWORD} characters.
              </p>
            )}
          </Field>
        </Collapse>

        {/* Confirm password — password sign-up only. */}
        <Collapse open={isSignUp && !usingCode}>
          <Field label="Confirm password" error={fieldErrors.confirmPassword}>
            <input
              type={showPassword ? "text" : "password"}
              required={isSignUp && !usingCode}
              disabled={!isSignUp || usingCode}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (fieldErrors.confirmPassword)
                  setFieldErrors({
                    ...fieldErrors,
                    confirmPassword: undefined,
                  });
              }}
              onFocus={() => setFocused("confirmPassword")}
              onBlur={() => setFocused(null)}
              className="w-full h-11 px-3 rounded-2xl outline-none text-[14px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  fieldErrors.confirmPassword
                    ? `${COLORS.red}80`
                    : focused === "confirmPassword"
                      ? COLORS.accent
                      : COLORS.borderLight
                }`,
                color: COLORS.w,
                transition: "border-color 150ms ease",
              }}
            />
          </Field>
        </Collapse>

        {topError && (
          <div
            className="px-3 py-2 rounded-2xl text-[12px]"
            style={{
              background: COLORS.redSoft,
              border: `1px solid ${COLORS.red}40`,
              color: COLORS.w,
            }}
            role="alert"
          >
            {topError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="h-12 rounded-2xl font-bold text-sm cursor-pointer transition-all duration-200 active:scale-[0.98] hover:-translate-y-0.5 hover:brightness-110 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:brightness-100 mt-2"
          style={{
            background: COLORS.accent,
            color: "#0A0F1C",
            boxShadow: `0 0 24px ${COLORS.accent}30`,
          }}
        >
          {submitting ? (
            "…"
          ) : (
            <span key={submitLabel} className="animate-in fade-in duration-200">
              {submitLabel}
            </span>
          )}
        </button>
      </form>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="flex-1 h-[1px]"
          style={{ background: COLORS.border }}
        />
        <span
          className="text-[11px] uppercase tracking-wide"
          style={{ color: COLORS.t4 }}
        >
          or
        </span>
        <div
          className="flex-1 h-[1px]"
          style={{ background: COLORS.border }}
        />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        className="h-12 rounded-2xl font-semibold text-sm cursor-pointer transition-all duration-200 active:scale-[0.98] hover:-translate-y-0.5 flex items-center justify-center gap-2 border bg-[var(--color-surface)] border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)]"
        style={{ color: COLORS.w }}
      >
        <GoogleGlyph />
        Continue with Google
      </button>

      <div className="text-center text-[13px]" style={{ color: COLORS.t3 }}>
        {isSignUp ? "Already have an account? " : "New to Tarjuman? "}
        {onSwitchMode ? (
          <button
            type="button"
            onClick={() => onSwitchMode(isSignUp ? "signIn" : "signUp")}
            className="font-semibold cursor-pointer"
            style={{ color: COLORS.accent }}
          >
            {isSignUp ? "Sign in" : "Create one"}
          </button>
        ) : (
          <Link
            href={isSignUp ? "/login" : "/signup"}
            className="font-semibold"
            style={{ color: COLORS.accent }}
          >
            {isSignUp ? "Sign in" : "Create one"}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Height-animated show/hide that stays mounted, so the popup grows and shrinks
 * smoothly instead of snapping. The negative margin reclaims the parent's
 * 12px flex gap while closed (no empty gap); `inert` keeps hidden fields out
 * of the tab order and the accessibility tree.
 *
 * Uses the grid-template-rows 0fr ↔ 1fr technique (same as
 * landing/faq-item.tsx) rather than a max-height. max-height needs a magic
 * number big enough for the tallest possible content — and would clip the
 * moment a validation error line rendered under a field. 1fr resolves to the
 * content's natural height, in both directions, with no measurement.
 */
function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className="grid transition-[grid-template-rows,opacity,margin-bottom] duration-300 ease-out motion-reduce:transition-none"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        marginBottom: open ? 0 : -12,
      }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

const METHODS: { id: Method; label: string }[] = [
  { id: "password", label: "Password" },
  { id: "code", label: "Email code" },
];

/** Password · Email code — a segmented control with a sliding thumb. */
function MethodTabs({
  value,
  onChange,
}: {
  value: Method;
  onChange: (next: Method) => void;
}) {
  const [hovered, setHovered] = useState<Method | null>(null);
  const index = METHODS.findIndex((m) => m.id === value);
  return (
    <div
      role="group"
      aria-label="How do you want to sign in?"
      className="relative grid grid-cols-2 p-1 rounded-2xl mb-1"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.borderLight}`,
      }}
    >
      <div
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-xl transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{
          width: "calc(50% - 4px)",
          transform: `translateX(${index * 100}%)`,
          background: COLORS.accentSoft,
          border: `1px solid ${COLORS.accent}66`,
          boxShadow: `0 0 16px ${COLORS.accent}26`,
        }}
      />
      {METHODS.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(m.id)}
            onPointerEnter={() => setHovered(m.id)}
            onPointerLeave={() => setHovered(null)}
            className="relative h-9 rounded-xl text-[13px] font-semibold cursor-pointer"
            style={{
              color: active || hovered === m.id ? COLORS.w : COLORS.t3,
              transition: "color 200ms ease",
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  error,
  rightLink,
  children,
}: {
  label: string;
  error?: string;
  rightLink?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label
          className="text-[11px] font-semibold tracking-wide uppercase block"
          style={{ color: COLORS.t4 }}
        >
          {label}
        </label>
        {rightLink}
      </div>
      {children}
      {error && (
        <p
          className="text-[11px] mt-1 font-semibold"
          style={{ color: COLORS.red }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.84.73 3.49 1.34l2.55-2.49C13.46.86 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.94 2.28C4.6 5.05 6.62 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#FBBC05"
        d="M3.9 10.71a5.5 5.5 0 0 1-.3-1.74c0-.6.1-1.18.29-1.74L.96 4.96A8.96 8.96 0 0 0 0 8.97c0 1.45.35 2.82.96 4.01l2.94-2.27z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"
      />
    </svg>
  );
}
