import type { NextConfig } from 'next';

// Normalize BACKEND_URL into a value Next's rewrite validator accepts. Railway's
// variable reference pickers (and hand-typed values) commonly yield a BARE host
// like "backend-production-xxxx.up.railway.app" with no scheme — Next then fails
// the build with: `destination` does not start with `/`, `http://`, or `https://`.
// So: prepend https:// when a scheme is missing, and trim any trailing slash so the
// `${backendURL}/api/v1/...` concatenation stays clean. A value that already carries
// http:// or https:// (incl. the local-dev default) passes through untouched.
function normalizeBackendURL(raw: string): string {
  const url = raw.trim();
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withScheme.replace(/\/+$/, '');
}

// Where the Next server proxies /api/v1/* to. Defaults to the local backend for
// dev; in production (e.g. Railway) set BACKEND_URL to the backend service URL.
const backendURL = normalizeBackendURL(process.env.BACKEND_URL ?? 'http://127.0.0.1:8080');

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
