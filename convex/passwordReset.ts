import Resend from "@auth/core/providers/resend";

/**
 * Password-reset email provider using Loops.so.
 *
 * Why Loops (not Resend):
 *   Loops handles the template lifecycle (subject, sender, design) on
 *   their dashboard — we just call their transactional endpoint with a
 *   template ID and data variables. This keeps email copy out of source
 *   control and lets non-engineers tweak it without a deploy.
 *
 * Env vars (set via `npx convex env set ...` — these are Convex env, not
 * .env.local):
 *   LOOPS_API_KEY              — your Loops API key (Settings → API)
 *   LOOPS_PASSWORD_RESET_ID    — the transactional template ID for the
 *                                 password-reset email. The template must
 *                                 reference {{code}} as a data variable (we
 *                                 also pass {{otp}} as an alias).
 *
 * Dev fallback: if either env var is missing, the OTP is logged to
 * Convex logs (visible at the dashboard → Logs). The reset flow still
 * works end-to-end during development without setting up Loops.
 *
 * Why we still wrap with @auth/core/providers/resend: it's the simplest
 * way to construct an EmailConfig that satisfies @convex-dev/auth's
 * Password provider type. We override `sendVerificationRequest` so
 * Resend's actual API is never called — only the EmailConfig wrapper is
 * borrowed.
 */

function generateOtp(length = 6): string {
  // 6 digits = 1M combinations; with 15-min TTL + rate limiting that's
  // adequate for OTP. Crypto-random for unpredictability.
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) out += (buf[i] % 10).toString();
  return out;
}

async function sendViaLoops(email: string, otp: string): Promise<void> {
  const apiKey = process.env.LOOPS_API_KEY;
  const transactionalId = process.env.LOOPS_PASSWORD_RESET_ID;

  if (!apiKey || !transactionalId) {
    console.log(
      `[passwordReset] DEV FALLBACK — Loops not configured. ` +
        `Reset code for ${email} is: ${otp}. ` +
        `To enable real email, set LOOPS_API_KEY and LOOPS_PASSWORD_RESET_ID ` +
        `via \`npx convex env set\`.`
    );
    return;
  }

  const res = await fetch("https://app.loops.so/api/v1/transactional", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transactionalId,
      email,
      // The Loops template's required data variable is `code`. We also send
      // `otp` so the template keeps working if it's ever edited to use {{otp}}.
      dataVariables: { code: otp, otp },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Loops rejected the email (${res.status}): ${body.slice(0, 200)}`
    );
  }
}

export const PasswordResetEmail = Resend({
  id: "password-reset",
  // Resend's @auth/core wrapper requires apiKey to be a non-empty string at
  // initialization time, but we override sendVerificationRequest below so
  // Resend's API is never actually called. The placeholder is fine.
  apiKey: process.env.LOOPS_API_KEY ?? "loops-via-resend-wrapper",
  maxAge: 60 * 15, // 15 minutes — long enough to find the email, short
                   // enough to limit exposure if the address is leaked.
  async generateVerificationToken() {
    return generateOtp(6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendViaLoops(email, token);
  },
});
