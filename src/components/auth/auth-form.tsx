"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

interface AuthFormProps {
  mode: "signIn" | "signUp";
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

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

export function AuthForm({ mode }: AuthFormProps) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const isSignUp = mode === "signUp";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // After a successful signup, hold on the success state for ~1.2s so the
  // user sees the confirmation, then route forward.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => router.push("/record"), 1200);
    return () => clearTimeout(t);
  }, [success, router]);

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
        setSuccess(true);
      } else {
        router.push("/record");
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setTopError(friendlyError(raw, mode));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setTopError(null);
    try {
      await signIn("google", { redirectTo: "/record" });
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
            Account created
          </h1>
          <p className="text-[13px] mt-1" style={{ color: COLORS.t3 }}>
            Welcome to LiveTranscribe. Taking you to the recorder…
          </p>
        </div>
      </div>
    );
  }

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
          LiveTranscribe
        </span>
      </div>

      <div>
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

      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <Field
          label="Email"
          error={fieldErrors.email}
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email)
                setFieldErrors({ ...fieldErrors, email: undefined });
            }}
            className="w-full h-11 px-3 rounded-lg outline-none text-[14px]"
            style={{
              background: COLORS.surface,
              border: `1px solid ${
                fieldErrors.email ? `${COLORS.red}80` : COLORS.borderLight
              }`,
              color: COLORS.w,
            }}
          />
        </Field>

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
              className="w-full h-11 pl-3 pr-12 rounded-lg outline-none text-[14px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  fieldErrors.password ? `${COLORS.red}80` : COLORS.borderLight
                }`,
                color: COLORS.w,
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

        {isSignUp && (
          <Field
            label="Confirm password"
            error={fieldErrors.confirmPassword}
          >
            <input
              type={showPassword ? "text" : "password"}
              required
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
              className="w-full h-11 px-3 rounded-lg outline-none text-[14px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  fieldErrors.confirmPassword
                    ? `${COLORS.red}80`
                    : COLORS.borderLight
                }`,
                color: COLORS.w,
              }}
            />
          </Field>
        )}

        {topError && (
          <div
            className="px-3 py-2 rounded-lg text-[12px]"
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
          className="h-12 rounded-xl font-bold text-sm cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-60 mt-2"
          style={{
            background: COLORS.accent,
            color: "#0A0F1C",
            boxShadow: `0 0 24px ${COLORS.accent}30`,
          }}
        >
          {submitting ? "…" : isSignUp ? "Create account" : "Sign in"}
        </button>
      </form>

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
        className="h-12 rounded-xl font-semibold text-sm cursor-pointer transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.borderLight}`,
          color: COLORS.w,
        }}
      >
        <GoogleGlyph />
        Continue with Google
      </button>

      <div className="text-center text-[13px]" style={{ color: COLORS.t3 }}>
        {isSignUp ? "Already have an account? " : "New to LiveTranscribe? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="font-semibold"
          style={{ color: COLORS.accent }}
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </div>
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
