/**
 * The one place Tarjuman emails a 6-digit auth code — the password-reset code
 * (passwordReset.ts) and the passwordless sign-in code (emailCode.ts). Same
 * sender, same warm template; only the wording changes with `purpose`.
 *
 * Why Resend:
 *   Resend offers a built-in test sender (`onboarding@resend.dev`) that works
 *   WITHOUT verifying a domain — you can start sending codes immediately.
 *   We compose the email (subject + body containing the 6-digit code) right
 *   here in code, so there's no external template to keep in sync.
 *
 *   ⚠️ Test-sender limitation: until you verify your own domain in Resend,
 *   `onboarding@resend.dev` can only deliver to the email address your Resend
 *   account is registered with. To email ANY user, verify a domain in Resend
 *   and set RESEND_FROM to an address on it (e.g. "Tarjuman <no-reply@yourdomain>").
 *
 * Env vars (set via `bunx convex env set ...` — Convex env, not .env.local):
 *   RESEND_API_KEY  — your Resend API key (resend.com → API Keys). Required to
 *                      actually send. Without it, the code is logged instead.
 *   RESEND_FROM     — optional. The "From" address. Defaults to the Resend test
 *                      sender. Set this once you've verified a domain.
 *
 * Dev fallback: if RESEND_API_KEY is missing, the code is logged to Convex logs
 * (dashboard → Logs), so both flows work end-to-end in development without
 * setting up Resend.
 */

const DEFAULT_FROM = "Tarjuman <onboarding@resend.dev>";

/** Minutes a code stays valid — shared by both providers and their copy. */
export const CODE_TTL_MINUTES = 15;

export type CodePurpose = "reset" | "signin";

export function generateOtp(length = 6): string {
  // 6 digits = 1M combinations; with a 15-min TTL, Convex Auth's 10 failed
  // verifications per hour, and the send limit in authThrottle.ts that's
  // adequate for an OTP. Crypto-random for unpredictability.
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) out += (buf[i] % 10).toString();
  return out;
}

const COPY: Record<
  CodePurpose,
  { subject: string; heading: string; body: string; text: string; ignore: string }
> = {
  reset: {
    subject: "Your Tarjuman reset code",
    heading: "Reset your password",
    body: `Enter this 6-digit code in the app to set a new password. It expires in ${CODE_TTL_MINUTES} minutes.`,
    text: "Your Tarjuman password reset code is",
    ignore:
      "If you didn't request a password reset, you can safely ignore this email — your password won't change.",
  },
  signin: {
    subject: "Your Tarjuman sign-in code",
    heading: "Your sign-in code",
    body: `Enter this 6-digit code in Tarjuman to sign in. It expires in ${CODE_TTL_MINUTES} minutes.`,
    text: "Your Tarjuman sign-in code is",
    ignore:
      "If you didn't try to sign in, you can safely ignore this email — nobody can get in without this code.",
  },
};

export async function sendCodeEmail({
  to,
  code,
  purpose,
}: {
  to: string;
  code: string;
  purpose: CodePurpose;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;
  const copy = COPY[purpose];

  if (!apiKey) {
    console.log(
      `[authEmail] DEV FALLBACK — RESEND_API_KEY not set. ` +
        `${purpose} code for ${to} is: ${code}. ` +
        `To send real email, set RESEND_API_KEY via \`bunx convex env set\`.`
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
      to,
      subject: `${copy.subject}: ${code}`,
      text:
        `${copy.text} ${code}.\n\n` +
        `It expires in ${CODE_TTL_MINUTES} minutes. ${copy.ignore}`,
      // Email-safe layout: a full-width <table> with a dark bgcolor fills the
      // entire message area edge-to-edge (a plain <div> leaves the client's
      // white background showing around it). Inner fixed-width table centers
      // the content.
      html:
        // Warm palette: cream page, ivory card, soft brown text, amber accent.
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background-color:#FBF4E9">` +
        `<tr><td align="center" style="padding:40px 16px;background-color:#FBF4E9">` +
        `<table role="presentation" width="460" cellpadding="0" cellspacing="0" border="0" style="width:460px;max-width:460px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
        // Brand wordmark
        `<tr><td style="padding:0 0 24px">` +
        `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:#E8943A;vertical-align:middle"></span>` +
        `<span style="margin-left:8px;font-size:16px;font-weight:700;color:#43342A;vertical-align:middle">Tarjuman</span>` +
        `</td></tr>` +
        // Card
        `<tr><td style="background-color:#FFFDF8;border:1px solid #EDDFC9;border-radius:16px;padding:32px">` +
        `<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#3B2E23">${copy.heading}</h1>` +
        `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#8A7866">${copy.body}</p>` +
        `<div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;color:#B45309;background-color:#FBEFD9;border:1px solid #F0D9A8;border-radius:12px;padding:20px 0">${code}</div>` +
        `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#A6927C">${copy.ignore}</p>` +
        `</td></tr>` +
        // Footer
        `<tr><td style="padding:24px 0 0;text-align:center;font-size:11px;color:#B0A08C">Tarjuman · Real-time transcription &amp; translation</td></tr>` +
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
