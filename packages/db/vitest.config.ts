import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// No repo-root workspace yet (deliberate — see HANDOFF_SUPABASE_FASE0 §3): resolve
// @cdps/core to its TypeScript source so this package stays self-contained for dev
// and test without a build step or node_modules duplication.
export default defineConfig({
  resolve: {
    alias: {
      '@cdps/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
