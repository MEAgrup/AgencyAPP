import type { NextConfig } from 'next';

// Where the Next server proxies /api/* to — the apps/api service (Next +
// Supabase). `BACKEND_URL` (set per-environment in Vercel) always wins, so a
// staging build can point at a staging API. When it is unset we fall back by
// environment: the deployed apps/api (`agency-app-api`) in production, and the
// local apps/api dev port otherwise (run it with `-p 3001` while web-internal
// runs on 3000). (The legacy Go backend on :8080 is archived read-only.)
//
// THIS PROXY IS WHY THE CUSTOM DOMAIN NEEDS NO CORS. Browsers only ever talk to
// the canonical entry point (`https://app.meagency.co.id`) and every API call in
// `src/lib/*` is same-origin `/api/v1/...`; the hop to apps/api happens
// server-side, so no cross-origin request is ever made from the page. The
// session cookie (`cdps_access_token`, set by apps/api) rides back through this
// same hop and — carrying no `Domain` attribute — is scoped host-only to
// whatever hostname the browser used. Adding a client-side absolute API URL
// would break both properties at once: it would need CORS *and* the cookie
// would stop being sent. Keep the FE calling relative paths.
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
      // apps/api's liveness probe, reachable through the canonical domain so an
      // uptime check on `app.meagency.co.id` exercises the real path staff use
      // (FE server → proxy → API) instead of only the API's own hostname.
      // web-internal owns no `/api/*` routes of its own, so nothing is shadowed.
      {
        source: '/api/healthz',
        destination: `${backendURL}/api/healthz`,
      },
    ];
  },
};

export default nextConfig;
