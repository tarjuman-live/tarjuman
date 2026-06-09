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
});
