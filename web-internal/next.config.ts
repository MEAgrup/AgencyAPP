import type { NextConfig } from 'next';

// Where the Next server proxies /api/v1/* to. Defaults to the local backend for
// dev; in production (e.g. Railway) set BACKEND_URL to the backend service URL.
//
// Next.js requires the rewrite destination to include a scheme. Railway domains
// are often pasted bare (e.g. "app-production.up.railway.app"), which makes
// `next build` fail with "Invalid rewrite found". Normalize by adding https://
// when no scheme is present so a bare domain still works.
function resolveBackendURL(): string {
  const raw = process.env.BACKEND_URL?.trim();
  if (!raw) return 'http://127.0.0.1:8080';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const backendURL = resolveBackendURL();

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
