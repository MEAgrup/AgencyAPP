import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The @cdps/* packages ship as TypeScript source (no build step — see
  // packages/db/vitest.config.ts rationale). They are declared as `file:` deps in
  // package.json, so npm links them into node_modules; transpilePackages makes Next
  // compile that source like a workspace dependency. Build/dev use webpack
  // (`next build --webpack`, see package.json): Turbopack does not resolve the
  // TypeScript-source `file:` packages here, whereas webpack does via the file:
  // link + tsconfig `paths`.
  transpilePackages: ["@cdps/core", "@cdps/db", "@cdps/domain"],
};

export default nextConfig;
