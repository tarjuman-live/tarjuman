// .mjs (not .ts) so the production runtime doesn't need TypeScript installed.
// At build time Next.js parses this file directly via Node's ESM loader.
import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Fail the build on TS errors — don't silently let regressions through.
    ignoreBuildErrors: false,
  },
};

// Wrap for source-map upload → UNMINIFIED prod stack traces. This is a clean
// no-op until SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are set (in Vercel
// prod); locally and on previews without those, nothing uploads and the build is
// unaffected.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: false,
});
