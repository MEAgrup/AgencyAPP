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
