import type { NextConfig } from 'next';
import { resolveBackendURL } from './src/lib/backend-url';

// Where the Next server proxies /api/v1/* to — the apps/api service (Next +
// Supabase). `BACKEND_URL` (set per-environment on the deploy platform) always
// wins, so a staging build can point at a staging API. When it is unset we fall
// back by environment: the deployed apps/api (`agency-app-api`) in production,
// and the local apps/api dev port otherwise (run it with `-p 3001` while
// web-internal runs on 3000).
//
// A value pointing at the retired Go + MySQL stack (any Railway host, or :8080)
// FAILS THE BUILD rather than shipping a frontend whose every page talks to a
// backend that is being switched off. See src/lib/backend-url.ts for why that
// check earns its keep — the wiring is invisible from inside the repo.
const backendURL = resolveBackendURL({
  backendUrl: process.env.BACKEND_URL,
  nodeEnv: process.env.NODE_ENV,
  allowLegacy: process.env.ALLOW_LEGACY_BACKEND_URL,
});

const nextConfig: NextConfig = {
  // Dev-only: allow accessing the dev server via 127.0.0.1 as well as localhost
  // (Next 16 blocks cross-origin requests to /_next/* dev resources by default).
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendURL}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
