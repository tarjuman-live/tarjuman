import { defineConfig } from "vitest/config";

// Unit tests for pure library logic (no network, no DOM). The citation
// fail-safe in src/lib/{sunnah,quran}.ts is the highest-risk code in the app —
// these tests lock in that an unverified hadith/Quran citation can never read
// as authentic. Run with `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
