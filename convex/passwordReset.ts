import Resend from "@auth/core/providers/resend";
import { CODE_TTL_MINUTES, generateOtp, sendCodeEmail } from "./authEmail";

/**
 * Password-reset email provider. The email itself (Resend sender, template,
 * dev fallback) lives in authEmail.ts, shared with the passwordless sign-in
 * code in emailCode.ts.
 *
 * Why we still wrap with @auth/core/providers/resend: it's the simplest way to
 * construct an EmailConfig that satisfies @convex-dev/auth's Password provider
 * type. We override `sendVerificationRequest` so the email content + sender are
 * fully under our control.
 *
 * Sends are rate-limited per address in authThrottle.ts (enforced from the
 * createOrUpdateUser callback, before the code is written).
 */
export const PasswordResetEmail = Resend({
  id: "password-reset",
  // The @auth/core wrapper requires apiKey to be a non-empty string at
  // initialization time, but we override sendVerificationRequest below so this
  // value is only used as the default when the env var is unset.
  apiKey: process.env.RESEND_API_KEY ?? "resend-key-set-via-convex-env",
  maxAge: 60 * CODE_TTL_MINUTES, // long enough to find the email, short
                                 // enough to limit exposure if it leaks.
  async generateVerificationToken() {
    return generateOtp(6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendCodeEmail({ to: email, code: token, purpose: "reset" });
  },
});
