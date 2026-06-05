"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

type Stage = "request" | "verify" | "done";

function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid") && m.includes("code"))
    return "That code isn't valid. Check the email and try again.";
  if (m.includes("expired"))
    return "That code has expired. Request a new one below.";
  if (m.includes("invalidaccountid") || m.includes("not found"))
    return "No account found with that email.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("network") || m.includes("fetch failed"))
    return "Couldn't reach the server. Check your connection and try again.";
  if (m.includes("resend rejected"))
    return "Couldn't send the email. The Resend integration may not be configured yet — check Convex logs for the code as a dev fallback.";
  return raw;
}

/**
 * Errors from the "request code" step. Convex Auth checks the account exists
 * BEFORE sending any code, so the dominant failure here is "no email/password
 * account for this email" — which on a dev deployment reads `InvalidAccountId`
 * but on production is redacted to the generic "Server Error Called by client".
 * Both map to the same guidance: the account was probably created with Google,
 * which has no password to reset.
 */
function requestStageError(raw: string): string {
  const m = raw.toLowerCase();
  // Check the specific, recoverable cases first so they aren't swallowed by the
  // generic "no account" fallback below.
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("network") || m.includes("fetch failed"))
    return "Couldn't reach the server. Check your connection and try again.";
  if (m.includes("resend rejected"))
    return "Couldn't send the email. The Resend integration may not be configured yet — check Convex logs for the code as a dev fallback.";
  if (
    m.includes("invalidaccountid") ||
    m.includes("not found") ||
    m.includes("server error") ||
    m.includes("called by client")
  )
    return "We couldn't find an email-and-password account for that email. If you signed up with “Continue with Google”, go back to sign in and use that instead.";
  return friendlyError(raw);
}

/**
 * Errors from the "verify code" step. A wrong or expired code also redacts to
 * a generic server error on production, so treat unknown failures here as a
 * bad/expired code rather than an account problem.
 */
function verifyStageError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("network") || m.includes("fetch failed"))
    return "Couldn't reach the server. Check your connection and try again.";
  if (m.includes("expired"))
    return "That code has expired. Request a new one below.";
  if (
    m.includes("invalid") ||
    m.includes("server error") ||
    m.includes("called by client")
  )
    return "That code is invalid or expired. Request a new one below.";
  return friendlyError(raw);
}

export function ForgotPasswordForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();

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

  // After done, route to /login after a beat so the user sees confirmation.
  useEffect(() => {
    if (stage !== "done") return;
    const t = setTimeout(() => router.push("/login"), 1500);
    return () => clearTimeout(t);
  }, [stage, router]);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopError(null);
    setEmailError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      // Convex Auth's reset flow: triggers the configured `reset` provider
      // (Resend OTP) to email the user a 6-digit code. The promise resolves
      // when the email is queued — not when the user receives it.
      await signIn("password", {
        email: email.trim(),
        flow: "reset",
      });
      setStage("verify");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setTopError(requestStageError(raw));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopError(null);
    setCodeError(null);
    setPwError(null);
    setConfirmError(null);

    let bad = false;
    if (!code.trim()) {
      setCodeError("Code is required.");
      bad = true;
    }
    if (newPassword.length < MIN_PASSWORD) {
      setPwError(`At least ${MIN_PASSWORD} characters.`);
      bad = true;
    }
    if (confirmPassword !== newPassword) {
      setConfirmError("Passwords don't match.");
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
      const raw = e instanceof Error ? e.message : String(e);
      setTopError(verifyStageError(raw));
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "done") {
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
            Password updated
          </h1>
          <p className="text-[13px] mt-1" style={{ color: COLORS.t3 }}>
            Taking you to sign in…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 px-6 pt-12 pb-8 gap-6">
      <Link
        href="/login"
        className="self-start flex items-center gap-2 text-[13px]"
        style={{ color: COLORS.t3 }}
      >
        <Icon name="back" size={14} color={COLORS.t3} />
        Back to sign in
      </Link>

      <div>
        <h1 className="text-2xl font-bold" style={{ color: COLORS.w }}>
          {stage === "request" ? "Reset your password" : "Enter the code"}
        </h1>
        <p
          className="text-[13px] mt-1 leading-relaxed"
          style={{ color: COLORS.t3 }}
        >
          {stage === "request"
            ? "Enter the email associated with your account. We'll send a 6-digit code to reset your password."
            : `We sent a 6-digit code to ${email}. Enter it below along with your new password.`}
        </p>
        {stage === "request" && (
          <p className="text-[12px] mt-3" style={{ color: COLORS.t3 }}>
            Signed up with Google? There&apos;s no password to reset — go{" "}
            <Link
              href="/login"
              className="font-semibold underline"
              style={{ color: COLORS.accent }}
            >
              back to sign in
            </Link>{" "}
            and use “Continue with Google” instead.
          </p>
        )}
      </div>

      {stage === "request" && (
        <form onSubmit={requestCode} className="flex flex-col gap-3" noValidate>
          <Field label="Email" error={emailError ?? undefined}>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              className="w-full h-11 px-3 rounded-lg outline-none text-[14px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  emailError ? `${COLORS.red}80` : COLORS.borderLight
                }`,
                color: COLORS.w,
              }}
            />
          </Field>

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
            {submitting ? "Sending…" : "Send reset code"}
          </button>
        </form>
      )}

      {stage === "verify" && (
        <form onSubmit={verifyCode} className="flex flex-col gap-3" noValidate>
          <Field label="6-digit code" error={codeError ?? undefined}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
                if (codeError) setCodeError(null);
              }}
              className="w-full h-12 px-3 rounded-lg outline-none text-center font-mono tracking-[0.5em] text-[18px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  codeError ? `${COLORS.red}80` : COLORS.borderLight
                }`,
                color: COLORS.w,
              }}
            />
          </Field>

          <Field label="New password" error={pwError ?? undefined}>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={MIN_PASSWORD}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (pwError) setPwError(null);
                }}
                className="w-full h-11 pl-3 pr-12 rounded-lg outline-none text-[14px]"
                style={{
                  background: COLORS.surface,
                  border: `1px solid ${
                    pwError ? `${COLORS.red}80` : COLORS.borderLight
                  }`,
                  color: COLORS.w,
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-semibold cursor-pointer"
                style={{ color: COLORS.t3 }}
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <Field label="Confirm new password" error={confirmError ?? undefined}>
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmError) setConfirmError(null);
              }}
              className="w-full h-11 px-3 rounded-lg outline-none text-[14px]"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  confirmError ? `${COLORS.red}80` : COLORS.borderLight
                }`,
                color: COLORS.w,
              }}
            />
          </Field>

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
            {submitting ? "Updating…" : "Update password"}
          </button>

          <button
            type="button"
            onClick={() => {
              setStage("request");
              setCode("");
              setNewPassword("");
              setConfirmPassword("");
              setTopError(null);
            }}
            className="text-[12px] font-semibold mt-1 text-center"
            style={{ color: COLORS.t3 }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="text-[11px] font-semibold tracking-wide uppercase mb-1 block"
        style={{ color: COLORS.t4 }}
      >
        {label}
      </label>
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
