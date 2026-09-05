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
      // The bare `/klien` needs its OWN static entry, and it must come first.
      //
      // `/klien/:path*` alone looks like it covers it — path-to-regexp does
      // match `/klien` with zero segments, and `next dev` compiles the
      // destination back down to `/klien`. Vercel's edge does not: it applies
      // the routes-manifest regex
      // (`^/klien(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))*(?:/)?$`) and substitutes
      // the EMPTY capture into `…/klien/:path*` as a string, so the portal is
      // asked for `/klien/` — with the trailing slash left behind. The portal
      // (trailingSlash: false, like every app here) answers 308 → `/klien`,
      // the browser resolves that against app.meagency.co.id, and the whole
      // thing starts over: ERR_TOO_MANY_REDIRECTS on the Portal's front door
      // while every deeper path (`/klien/login`, …) worked fine.
      //
      // A source with no parameters compiles to a literal edge route with a
      // literal destination, so there is no empty capture to substitute and
      // no slash to strip. It matches `/klien/` too (Next appends the
      // optional `(?:/)?`), which is why the trailing-slash form is fixed by
      // the same entry rather than needing a third one.
      {
        source: '/klien',
        destination: `${clientPortalURL}/klien`,
      },
      {
        source: '/klien/:path*',
        destination: `${clientPortalURL}/klien/:path*`,
      },
    ];
  },
};

export default nextConfig;
