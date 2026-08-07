/**
 * Vitest config for web-internal.
 *
 * Exists for ONE reason: the `@/*` path alias from tsconfig.json. Until now every
 * tested module happened to import only relative paths (`nav.ts` → `./types`), so
 * a bare `vitest run` worked; the moment a test pulls in a module that imports
 * `@/lib/api` at runtime, resolution fails with "Cannot find package '@/lib/api'"
 * — which reads like a missing dependency rather than a missing alias. Mapping it
 * here keeps `lib/*` unit-testable without rewriting app imports to relative
 * paths (Next resolves `@/` at build time; the tests must agree with it).
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
