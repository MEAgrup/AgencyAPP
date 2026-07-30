import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// apps/api is a Next.js app (route handlers under src/app), so it shares
// web-internal's flat config: the same eslint-config-next presets and the same
// React-Compiler rule opt-out. Before this file existed `npm run lint -w
// @cdps/api` failed outright with "couldn't find an eslint.config.js", so
// ~250 TS files — every route handler and wire.ts — were never linted.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Mirror web-internal: the React Compiler is not enabled here, and the
      // "fetch in useEffect, setState on resolve" pattern the rule flags is the
      // sanctioned client-component data pattern (see web-internal/eslint.config.mjs).
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
