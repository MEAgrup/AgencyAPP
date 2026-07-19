import type { NextConfig } from 'next';

// Where the Next server proxies /api/v1/* to. Defaults to the local backend for
// dev; in production (e.g. Railway) set BACKEND_URL to the backend service URL.
const backendURL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8080';

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
