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
      // Email-safe layout: a full-width <table> with a dark bgcolor fills the
      // entire message area edge-to-edge (a plain <div> leaves the client's
      // white background showing around it). Inner fixed-width table centers
      // the content.
      html:
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background-color:#0A0F1C">` +
        `<tr><td align="center" style="padding:40px 16px;background-color:#0A0F1C">` +
        `<table role="presentation" width="460" cellpadding="0" cellspacing="0" border="0" style="width:460px;max-width:460px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
        // Brand wordmark
        `<tr><td style="padding:0 0 24px">` +
        `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:#2ECC71;vertical-align:middle"></span>` +
        `<span style="margin-left:8px;font-size:16px;font-weight:700;color:#ffffff;vertical-align:middle">LiveTranscribe</span>` +
        `</td></tr>` +
        // Card
        `<tr><td style="background-color:#111827;border:1px solid #1F2937;border-radius:16px;padding:32px">` +
        `<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#ffffff">Reset your password</h1>` +
        `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#94A3B8">Enter this 6-digit code in the app to set a new password. It expires in 15 minutes.</p>` +
        `<div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;color:#2ECC71;background-color:#0A0F1C;border:1px solid rgba(46,204,113,0.25);border-radius:12px;padding:20px 0">${otp}</div>` +
        `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748B">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>` +
        `</td></tr>` +
        // Footer
        `<tr><td style="padding:24px 0 0;text-align:center;font-size:11px;color:#475569">LiveTranscribe · Real-time transcription &amp; translation</td></tr>` +
        `</table>` +
        `</td></tr></table>`,
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
