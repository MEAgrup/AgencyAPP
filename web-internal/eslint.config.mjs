import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // eslint-config-next's core-web-vitals preset now ships the React
      // Compiler rule set at "error". This project does not enable the
      // React Compiler (no `experimental.reactCompiler`), and its pages
      // fetch personalized, cookie-session-gated data client-side (per the
      // API contract) — the standard "fetch in useEffect, setState on
      // resolve" pattern this rule flags is exactly what Next.js's own
      // client-component docs show, and is correct without the compiler.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // uat/ = skrip smoke Playwright standalone (CommonJS, dijalankan `node`
    // langsung dengan playwright dipasang ad-hoc) — bukan bagian app Next.
    "uat/**",
  ]),
]);

export default eslintConfig;
