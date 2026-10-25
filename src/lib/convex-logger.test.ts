import { describe, it, expect, vi, afterEach } from "vitest";
import { createConvexLogger, isExpectedAuthFailure } from "./convex-logger";

// Verbatim from a dev-deployment wrong-password sign-in (2026-10-25).
const DEV_WRONG_PASSWORD = `[CONVEX A(auth:signIn)] [Request ID: 9a7372394a57402d] Server Error
Uncaught Error: InvalidSecret
    at retrieveAccount (../../node_modules/@convex-dev/auth/src/server/implementation/index.ts:602:9)
    at async authorize [as authorize] (../../node_modules/@convex-dev/auth/src/providers/Password.ts:157:10)`;

// Production deployments redact plain Errors — no code to go on.
const PROD_REDACTED = "[CONVEX A(auth:signIn)] [Request ID: 9a7372394a57402d] Server Error";

describe("isExpectedAuthFailure", () => {
  it("matches a dev wrong-password failure", () => {
    expect(isExpectedAuthFailure(DEV_WRONG_PASSWORD)).toBe(true);
  });

  it("matches the other credential codes", () => {
    for (const code of ["InvalidAccountId", "TooManyFailedAttempts", "Invalid code"]) {
      expect(
        isExpectedAuthFailure(`[CONVEX A(auth:signIn)] [Request ID: x] Server Error\nUncaught Error: ${code}`),
      ).toBe(true);
    }
  });

  it("leaves a redacted prod failure as an error", () => {
    expect(isExpectedAuthFailure(PROD_REDACTED)).toBe(false);
  });

  it("ignores the same code from a non-auth function", () => {
    expect(
      isExpectedAuthFailure("[CONVEX M(sessions:addSegments)] [Request ID: x] Server Error\nUncaught Error: InvalidSecret"),
    ).toBe(false);
  });
});

describe("createConvexLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downgrades expected auth failures to warn and keeps the rest as error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConvexLogger();

    logger.error(DEV_WRONG_PASSWORD);
    expect(warn).toHaveBeenCalledWith(DEV_WRONG_PASSWORD);
    expect(error).not.toHaveBeenCalled();

    logger.error(PROD_REDACTED);
    expect(error).toHaveBeenCalledWith(PROD_REDACTED);
  });
});
