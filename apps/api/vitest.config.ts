import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the @cdps/* packages and the @/* app alias to source, so the lib unit
// tests (JWT verify, error mapping) run without a Next build. Same rationale as
// packages/db/vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@cdps/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@cdps/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)),
      '@cdps/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
