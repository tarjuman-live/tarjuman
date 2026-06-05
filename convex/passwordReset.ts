import Resend from "@auth/core/providers/resend";

/**
 * Password-reset email provider using Resend.
 *
 * Why Resend:
 *   Resend offers a built-in test sender (`onboarding@resend.dev`) that works
 *   WITHOUT verifying a domain — you can start sending reset codes immediately.
 *   We compose the email (subject + body containing the 6-digit code) right
 *   here in code, so there's no external template to keep in sync.
 *
 *   ⚠️ Test-sender limitation: until you verify your own domain in Resend,
 *   `onboarding@resend.dev` can only deliver to the email address your Resend
 *   account is registered with. That's enough to test the full flow and reset
 *   your own account. To email ANY user, verify a domain in Resend and set
 *   RESEND_FROM to an address on it (e.g. "LiveTranscribe <no-reply@yourdomain>").
 *
 * Env vars (set via `npx convex env set ...` — Convex env, not .env.local):
 *   RESEND_API_KEY  — your Resend API key (resend.com → API Keys). Required to
 *                      actually send. Without it, the code is logged instead.
 *   RESEND_FROM     — optional. The "From" address. Defaults to the Resend test
 *                      sender. Set this once you've verified a domain.
 *
 * Dev fallback: if RESEND_API_KEY is missing, the OTP is logged to Convex logs
 * (dashboard → Logs). The reset flow still works end-to-end in development
 * without setting up Resend.
 *
 * Why we still wrap with @auth/core/providers/resend: it's the simplest way to
 * construct an EmailConfig that satisfies @convex-dev/auth's Password provider
 * type. We override `sendVerificationRequest` so the email content + sender are
 * fully under our control.
 */

const DEFAULT_FROM = "LiveTranscribe <onboarding@resend.dev>";

function generateOtp(length = 6): string {
  // 6 digits = 1M combinations; with 15-min TTL + rate limiting that's
  // adequate for OTP. Crypto-random for unpredictability.
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) out += (buf[i] % 10).toString();
  return out;
}

async function sendViaResend(email: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;

  if (!apiKey) {
    console.log(
      `[passwordReset] DEV FALLBACK — RESEND_API_KEY not set. ` +
        `Reset code for ${email} is: ${otp}. ` +
        `To send real email, set RESEND_API_KEY via \`npx convex env set\`.`
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: `Your LiveTranscribe reset code: ${otp}`,
      text:
        `Your LiveTranscribe password reset code is ${otp}.\n\n` +
        `It expires in 15 minutes. If you didn't request a password reset, ` +
        `you can safely ignore this email.`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0A0F1C">` +
        `<h1 style="font-size:20px;margin:0 0 8px">Reset your password</h1>` +
        `<p style="font-size:14px;color:#475569;margin:0 0 20px">Enter this 6-digit code to reset your LiveTranscribe password.</p>` +
        `<div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#F1F5F9;border-radius:12px">${otp}</div>` +
        `<p style="font-size:12px;color:#94A3B8;margin:20px 0 0">This code expires in 15 minutes. If you didn't request a password reset, you can safely ignore this email.</p>` +
        `</div>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Resend rejected the email (${res.status}): ${body.slice(0, 300)}`
    );
  }
}

export const PasswordResetEmail = Resend({
  id: "password-reset",
  // The @auth/core wrapper requires apiKey to be a non-empty string at
  // initialization time, but we override sendVerificationRequest below so this
  // value is only used as the default when the env var is unset.
  apiKey: process.env.RESEND_API_KEY ?? "resend-key-set-via-convex-env",
  maxAge: 60 * 15, // 15 minutes — long enough to find the email, short
                   // enough to limit exposure if the address is leaked.
  async generateVerificationToken() {
    return generateOtp(6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendViaResend(email, token);
  },
});
