/**
 * Console logger for `ConvexReactClient`, shared by web and mobile.
 *
 * Convex's default logger `console.error`s EVERY failed function call, even
 * ones the caller catches and handles. A mistyped password therefore surfaced
 * as a red "Console Error" overlay in Next dev (and a red LogBox toast in the
 * Expo app) on top of the auth form's own "Email or password is incorrect" —
 * it looked like a crash.
 *
 * This logger matches the default one, except it downgrades expected
 * credential failures from `auth:signIn` to `console.warn`. Every other error
 * still goes to `console.error`. Production deployments redact the message to
 * a bare "Server Error" with no code, so prod logs are unaffected.
 *
 * Typed structurally: Convex doesn't export its `Logger` type publicly, and
 * mobile resolves its own copy of the `convex` package.
 */
export interface ConvexLogger {
  logVerbose(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * The plain-Error codes @convex-dev/auth throws for a bad password, an unknown
 * email, a locked-out account (too many failures) or a bad OTP code.
 */
const EXPECTED_AUTH_FAILURES = [
  "InvalidSecret",
  "InvalidAccountId",
  "TooManyFailedAttempts",
  "Invalid credentials",
  "Invalid code",
  "Could not verify code",
];

/** True for a Convex error log line that is a user's bad credentials, not a bug. */
export function isExpectedAuthFailure(message: string): boolean {
  if (!message.startsWith("[CONVEX A(auth:signIn)]")) return false;
  return EXPECTED_AUTH_FAILURES.some((code) => message.includes(code));
}

export function createConvexLogger(): ConvexLogger {
  return {
    // Convex only calls this when the client is constructed with `verbose`.
    logVerbose: () => {},
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => {
      if (typeof args[0] === "string" && isExpectedAuthFailure(args[0])) {
        console.warn(...args);
      } else {
        console.error(...args);
      }
    },
  };
}
