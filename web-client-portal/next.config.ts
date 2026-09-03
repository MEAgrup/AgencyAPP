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
/**
 * Portal CSP (spec §6, "Implikasi keamanan").
 *
 * `frame-ancestors 'none'` closes reverse clickjacking — nothing may embed the
 * Portal. `frame-src 'self'` is the other half: the only thing the Portal
 * frames is the report document, and that document is served by this very
 * origin (`/api/v1/client-portal/reports/{id}/html`, proxied through the
 * rewrite below).
 *
 * That pairing is what the spec left open as OQ-8. It planned a CROSS-ORIGIN
 * frame into `mea-client-reporting` and asked how to hand a separate system a
 * scoped, short-TTL token without leaking the Portal session cookie. Since the
 * report engine now lives inside CDPS, there is no second origin and no token
 * to pass: the browser sends the Portal's own cookie, the server resolves the
 * contact from it, and `frame-src` never has to name an external host.
 *
 * The report DOCUMENT carries its own, tighter CSP (set by the route handler)
 * allowing exactly the CDN hosts its Tailwind/Chart.js/font tags reference.
 * This header governs the Portal shell, which needs none of them.
 */
const CSP = [
  "default-src 'self'",
  // Next's runtime needs inline/eval in dev; the hashes it emits in production
  // are not knowable here, so `'unsafe-inline'` stays for the framework's own
  // bootstrap. No third-party script origin is allowed — the shell loads none.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

const nextConfig: NextConfig = {
  basePath: '/klien',
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
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
