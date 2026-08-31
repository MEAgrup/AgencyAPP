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

const nextConfig: NextConfig = {
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
