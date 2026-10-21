import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Two test projects:
//  - "unit": pure library logic (no network, no DOM) under src/. The citation
//    fail-safe in src/lib/{sunnah,quran}.ts is the highest-risk code in the app
//    — these tests lock in that an unverified hadith/Quran citation can never
//    read as authentic.
//  - "convex": Convex functions run in-memory by convex-test (edge-runtime
//    environment, per convex/_generated/ai/guidelines.md) plus pure modules
//    that live in convex/ (adminMetrics). Covers the /admin security gate,
//    comp grants, the deletion cascade and usage ingest.
// Run with `bun run test`.
export default defineConfig({
  resolve: {
    alias: {
      // Mirror the `@/*` → `src/*` path mapping from tsconfig.json. Without
      // this, any module under test that imports via the alias fails to
      // resolve at run time — and because a load failure skips the whole file,
      // the suite reports FEWER tests rather than a failure in the code under
      // test. (src/lib/sunnah.ts had no imports at all until the citation
      // attribution gate landed, which is why this never surfaced before.)
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        // `extends: true` inherits the alias above — without it the src tests
        // lose `@/…` resolution and silently drop out of the run.
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
