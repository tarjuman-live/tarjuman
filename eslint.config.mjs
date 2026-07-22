import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import convexPlugin from "@convex-dev/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Convex best practices: arg validators, explicit table ids, no filter() scans.
  ...convexPlugin.configs.recommended,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Convex codegen — not hand-written
    "convex/_generated/**",
    // Design prototype at the repo root — the visual source of truth per
    // CLAUDE.md, never compiled or shipped. Not held to app lint standards.
    "prototype.tsx",
  ]),
  {
    // Plain CommonJS Node entrypoint (package.json has no "type": "module");
    // require() is the correct import form here.
    files: ["server.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    rules: {
      // React 19's set-state-in-effect rule fires on legitimate external-sync
      // patterns this app relies on heavily: WebSocket connection state in
      // use-deepgram, RAF-driven audio level in audio-visualizer, interval-
      // driven elapsed time in use-session-timer, sticky-bottom scroll in
      // live-transcript. Each is "synchronize React state with an external
      // event stream" — the pattern the rule technically permits but its
      // syntactic check can't recognize. Downgraded to warn so it stays
      // visible without blocking builds; revisit during a polish pass.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
