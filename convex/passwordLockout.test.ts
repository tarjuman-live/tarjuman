import { describe, expect, it } from "vitest";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import { withVisibleLockout } from "./passwordLockout";

/**
 * Drives the REAL Password provider: its authorize asks the auth:store mutation
 * to check the credentials, and turns a failure code into Error(code). The stub
 * plays that mutation, so this breaks if the library moves its authorize or
 * renames the lockout code — the two things the wrapper depends on.
 */
async function signInFailingWith(code: string) {
  const provider = withVisibleLockout(Password());
  const { authorize } = (provider as unknown as {
    options: { authorize: (params: object, ctx: object) => Promise<unknown> };
  }).options;
  const ctx = { runMutation: async () => code };
  return authorize({ email: "someone@example.com", password: "hunter22", flow: "signIn" }, ctx);
}

describe("withVisibleLockout", () => {
  it("rethrows the lockout as a ConvexError, so prod redaction keeps the code", async () => {
    const err = await signInFailingWith("TooManyFailedAttempts").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe("TooManyFailedAttempts");
  });

  it("leaves a wrong password and an unknown email as plain, redactable Errors", async () => {
    for (const code of ["InvalidSecret", "InvalidAccountId"]) {
      const err = await signInFailingWith(code).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(ConvexError);
      expect((err as Error).message).toBe(code);
    }
  });

  it("refuses a provider without the internal authorize", () => {
    expect(() => withVisibleLockout({} as ReturnType<typeof Password>)).toThrow(/shape changed/);
  });
});
