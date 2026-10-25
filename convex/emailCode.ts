import { Email } from "@convex-dev/auth/providers/Email";
import { CODE_TTL_MINUTES, generateOtp, sendCodeEmail } from "./authEmail";

/** Provider id — the client calls signIn(EMAIL_CODE_PROVIDER_ID, …). */
export const EMAIL_CODE_PROVIDER_ID = "email-code";

/**
 * Passwordless sign-in / sign-up: a 6-digit code emailed to the user.
 *
 *   signIn("email-code", { email })        → emails a code
 *   signIn("email-code", { email, code })  → verifies it and signs in
 *
 * The same two calls create the account on first use, so sign-up and sign-in
 * are one flow. The default `authorize` from Email() stays on: a short code is
 * only accepted together with the email it was sent to.
 *
 * The client trims + lowercases the email before both calls — the code row is
 * keyed by the exact string, so the two calls must agree.
 *
 * Account linking (an existing password user who picks "Email code" lands in
 * their own account, not a new empty one) and the per-address send limit both
 * live in authLinking.ts / authThrottle.ts, wired via convexAuth's
 * createOrUpdateUser callback in auth.ts.
 */
export const EmailCode = Email({
  id: EMAIL_CODE_PROVIDER_ID,
  maxAge: 60 * CODE_TTL_MINUTES,
  async generateVerificationToken() {
    return generateOtp(6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendCodeEmail({ to: email, code: token, purpose: "signin" });
  },
});
