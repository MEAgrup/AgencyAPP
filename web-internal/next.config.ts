import type { NextConfig } from 'next';

// Where the Next server proxies /api/v1/* to — the apps/api service (Next +
// Supabase). Defaults to apps/api's local dev port (run it with `-p 3001` while
// web-internal runs on 3000). In production set BACKEND_URL to the deployed
// apps/api URL. (The legacy Go backend on :8080 is archived read-only.)
const backendURL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

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
