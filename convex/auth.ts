import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { PasswordResetEmail } from "./passwordReset";

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
