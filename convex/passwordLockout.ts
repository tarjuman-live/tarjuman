import type { Password } from "@convex-dev/auth/providers/Password";
import type { ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { ConvexError } from "convex/values";

type Authorize = ConvexCredentialsUserConfig["authorize"];

/**
 * Password provider whose lockout survives production redaction.
 *
 * After 10 wrong passwords an hour Convex Auth refuses even the RIGHT password
 * with a plain Error("TooManyFailedAttempts"), which prod redacts to a bare
 * "Server Error" — so the form said "check your email and password" and the
 * user kept trying (and stayed locked). Rethrown as a ConvexError, the code
 * reaches the client in `.data`. Every other failure passes through untouched:
 * wrong password and unknown email stay indistinguishable on purpose.
 *
 * Password() keeps its real authorize in the internal `options` (the top-level
 * one is a stub the library merges over — ConvexCredentials.ts,
 * provider_utils.ts providerDefaults). If that shape ever changes this throws
 * at push time instead of silently dropping the wrapper.
 */
export function withVisibleLockout(provider: ReturnType<typeof Password>) {
  const options = (provider as { options?: { authorize?: Authorize } }).options;
  const authorize = options?.authorize;
  if (!options || !authorize) {
    throw new Error("Password provider shape changed: update withVisibleLockout");
  }
  options.authorize = async (params, ctx) => {
    try {
      return await authorize(params, ctx);
    } catch (e) {
      if (e instanceof Error && e.message === "TooManyFailedAttempts") {
        throw new ConvexError("TooManyFailedAttempts");
      }
      throw e;
    }
  };
  return provider;
}
