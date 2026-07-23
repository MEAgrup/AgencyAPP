import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The @cdps/* packages are shipped as TypeScript source (no build step yet —
  // see packages/db/vitest.config.ts rationale). Have Next transpile them from
  // source like a normal monorepo workspace dependency.
  transpilePackages: ["@cdps/core", "@cdps/db", "@cdps/domain"],
};

export default nextConfig;
