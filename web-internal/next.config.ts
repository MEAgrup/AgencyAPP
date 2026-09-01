import type { NextConfig } from 'next';

// Where the Next server proxies /api/v1/* to — the apps/api service (Next +
// Supabase). `BACKEND_URL` (set per-environment in Vercel) always wins, so a
// staging build can point at a staging API. When it is unset we fall back by
// environment: the deployed apps/api (`agency-app-api`) in production, and the
// local apps/api dev port otherwise (run it with `-p 3001` while web-internal
// runs on 3000). (The legacy Go backend on :8080 is archived read-only.)
const backendURL =
  process.env.BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'https://agency-app-api.vercel.app'
    : 'http://127.0.0.1:3001');

// Owner decision 2026-09-01 (DECISIONS.md): Client Portal is reachable under
// THIS domain (app.meagency.co.id/klien/*) rather than its own — Next.js
// "multi zones" pattern, same proxy technique as the backendURL rewrite
// above, just fronting a second Next.js app instead of the API. The other
// app owns `basePath: '/klien'` (web-client-portal/next.config.ts) so its
// own routes/assets already expect the prefix; this rewrite only needs to
// forward it unchanged. `CLIENT_PORTAL_URL` wins when set (per-environment),
// otherwise the deployed web-client-portal in production, its local dev port
// otherwise (run it with `-p 3002` while web-internal runs on 3000).
const clientPortalURL =
  process.env.CLIENT_PORTAL_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'https://web-client-portal.vercel.app'
    : 'http://127.0.0.1:3002');

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
      {
        source: '/klien/:path*',
        destination: `${clientPortalURL}/klien/:path*`,
      },
    ];
  },
};

export default nextConfig;
