import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { PasswordResetEmail } from "./passwordReset";
import { internal } from "./_generated/api";

/** Constant-time string compare (the Convex runtime has no timingSafeEqual). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * DEV-ONLY sign-in bypass for simulators (user request 2026-10-09: "bypass the
 * sign in"). Development builds of the iOS app call signIn("dev-bypass",
 * { secret }) on launch and land signed in as DEV_AUTH_BYPASS_EMAIL — no
 * Google round-trip, no password.
 *
 * Disabled unless BOTH Convex env vars are set on the deployment:
 *   DEV_AUTH_BYPASS_SECRET  long random secret (also in mobile/.env.local,
 *                           gitignored, as EXPO_PUBLIC_DEV_AUTH_BYPASS_SECRET)
 *   DEV_AUTH_BYPASS_EMAIL   the existing account to sign in as
 * NEVER set these on the production deployment: with them unset every
 * attempt is refused, so the provider is inert in prod.
 */
const DevBypass = ConvexCredentials({
  id: "dev-bypass",
  authorize: async (credentials, ctx) => {
    const expected = process.env.DEV_AUTH_BYPASS_SECRET;
    const email = process.env.DEV_AUTH_BYPASS_EMAIL;
    if (!expected || expected.length < 32 || !email) return null;
    const given = credentials.secret;
    if (typeof given !== "string" || !safeEqual(given, expected)) return null;
    const userId = await ctx.runQuery(internal.devAuth.userIdByEmail, { email });
    return userId ? { userId } : null;
  },
});

/**
 * Auth setup for Tarjuman.
 *
 * Three providers:
 * - Password: email + password. Convex Auth handles hashing/salting/user
 *   creation. The `reset` option enables the forgot-password flow via OTP.
 * - Google: OAuth via @auth/core. Requires AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET
 *   set as Convex env vars (NOT in .env.local — those are for the Next.js
 *   process; Convex env is separate).
 *
 * The exported `auth` object is consumed by:
 * - convex/http.ts to register OAuth callback routes
 * - any query/mutation that calls auth.getUserId(ctx) for ownership checks
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({ reset: PasswordResetEmail }),
    Google,
    DevBypass,
  ],
  callbacks: {
    /**
     * Where OAuth may send the browser back to. Same rule as the library
     * default (relative paths or anything on SITE_URL), plus the iOS app's own
     * scheme: the native Google flow finishes at `tarjuman://?code=…`, which
     * the app exchanges for a session. The code alone is useless without the
     * verifier the app kept locally, so another app claiming the scheme gains
     * nothing.
     */
    async redirect({ redirectTo }) {
      if (/^tarjuman:\/\//.test(redirectTo)) return redirectTo;
      const baseUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("SITE_URL is not set");
      if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) {
        return `${baseUrl}${redirectTo}`;
      }
      if (redirectTo.startsWith(baseUrl)) {
        const after = redirectTo[baseUrl.length];
        if (after === undefined || after === "?" || after === "/") {
          return redirectTo;
        }
      }
      throw new Error(`Invalid redirectTo ${redirectTo} for SITE_URL ${baseUrl}`);
    },
  },
});
