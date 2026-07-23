import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Same rationale as packages/db (no repo-root workspace yet): resolve the sibling
// @cdps packages to their TypeScript source so this package tests without a build
// step. The alias is global, so @cdps/core imports made *inside* @cdps/db source
// resolve here too.
export default defineConfig({
  resolve: {
    alias: {
      '@cdps/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@cdps/db': fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // The integration suites each open a postgres.js pool against ONE shared DB;
    // running every file in parallel multiplies the pools and storms the server's
    // connection slots. These DB tests are I/O-light, so serialize files (unit
    // tests within a file still run together) — reliable over marginally faster.
    fileParallelism: false,
  },
});
