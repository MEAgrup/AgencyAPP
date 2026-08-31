/**
 * Vitest config for web-client-portal. Same reason as web-internal's: maps
 * the `@/*` tsconfig alias so `@/lib/*` unit tests resolve outside Next's own
 * build-time resolver.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
