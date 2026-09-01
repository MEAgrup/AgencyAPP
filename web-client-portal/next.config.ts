import type { NextConfig } from 'next';

// Same BFF proxy pattern as web-internal/next.config.ts: Client Portal talks
// to the SAME apps/api backend (one API serves every realm — employee,
// vendor, and now client-contact — branching by resolved Actor, not by
// which frontend calls it). `BACKEND_URL` wins when set (per-environment,
// e.g. Vercel); otherwise the deployed apps/api in production, the local dev
// port otherwise.
const backendURL =
  process.env.BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'https://agency-app-api.vercel.app'
    : 'http://127.0.0.1:3001');

// Owner decision 2026-09-01 (DECISIONS.md): Client Portal is served under
// app.meagency.co.id/klien/* rather than its own domain — Next.js "multi
// zones" pattern, mirrored by the matching rewrite in
// web-internal/next.config.ts. `basePath` makes every route/asset/next/link
// navigation in THIS app resolve under `/klien` automatically; a handful of
// plain <a href> tags that predate this were switched to next/link (see
// src/app/login, /lupa-password, /reset-password) since a raw anchor does
// NOT get basePath-prefixed the way next/link and useRouter do.
const nextConfig: NextConfig = {
  basePath: '/klien',
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
