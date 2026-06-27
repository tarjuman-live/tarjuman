/**
 * Sentry init helpers.
 *
 * The init is opt-in: if NEXT_PUBLIC_SENTRY_DSN is not set, all init
 * functions silently no-op and the rest of the app behaves as if Sentry
 * isn't installed. This keeps the dev experience friction-free for anyone
 * cloning the repo without their own Sentry account.
 *
 * To enable in your environment:
 *   1. sentry.io → Create Project → Next.js platform
 *   2. Copy the DSN
 *   3. Set NEXT_PUBLIC_SENTRY_DSN in .env.local (and as a Vercel env var
 *      when deployed). For UNMINIFIED prod stack traces also set SENTRY_ORG,
 *      SENTRY_PROJECT, and SENTRY_AUTH_TOKEN in Vercel (source-map upload —
 *      wired in next.config.mjs via withSentryConfig).
 *   4. Restart the dev server
 *
 * What's captured:
 *   - Unhandled JS errors on the client
 *   - Server-side route handler errors
 *   - The error boundary at src/app/(app)/error.tsx forwards manually-caught
 *     errors via Sentry.captureException
 */
import * as Sentry from "@sentry/nextjs";

let initialized = false;

export function initSentry(scope: "client" | "server" | "edge"): void {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Conservative trace sampling — adjust as you learn what's expensive.
    tracesSampleRate: 0.1,
    // Replay sessions are expensive; keep low. Enable per-error replay only.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV ??
      "development",
    // Tag the scope so we can filter dashboard by client/server.
    initialScope: { tags: { scope } },
  });
  initialized = true;
}

export { Sentry };
