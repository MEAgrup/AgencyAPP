# web-client-portal

External-facing Client Portal for MEA Agency clients (M15-C2). Standalone
Next.js app, same shape as `web-internal` (own `package.json`, own deploy),
never sharing a build with it.

## Status

**Auth realm cluster built** (this PR — O4/O5 RESOLVED 2026-08-31, spec
`docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`): login, force-change gate,
self-service change-password, self-service "lupa password" (request +
completion), and the `web-internal` admin screen (`admin/client-contacts`)
for AM/Account-lead/Director to invite and manage contacts.

**Not yet built** (later clusters, per the spec's own roadmap): Service
Progress (relabeled Universal Column), Health Summary band, the natively
embedded report (`mea-client-reporting` — OQ-8, token pass-through mechanism
still open), and the complaint submission form. `(portal)/page.tsx` is a
placeholder landing page until those land.

**4-hour idle session TTL (spec §3.5) built** (`src/lib/idle-timeout.ts`,
wired into `api.ts`/`portal-auth-context.tsx`/`(portal)/layout.tsx`): every
API call records activity in `localStorage`; the portal shell checks on
mount and every minute after, and past 4 idle hours calls a real logout
(revokes the GoTrue session server-side, not just a client-side redirect)
then sends the contact to `/login?reason=idle`. This is enforced at this
app's layer only — the underlying GoTrue token TTL is unchanged (would also
shorten the employee/vendor realms' all-day sessions).

**Login rate limiting (spec §5.2, OQ-5) built** (2026-08-31 follow-up,
`docs/DECISIONS.md` O64): 10 attempts/IP/15min, enforced in `apps/api`
(`packages/domain/src/auth.ts` `enforceLoginRateLimit`, called from
`POST /auth/login` before GoTrue is even reached). Applied **uniformly**
across all three CDPS auth realms, not Portal-only — `/auth/login` is one
shared endpoint that only knows which realm resolved AFTER GoTrue
authenticates, so a Portal-only gate would have needed a weaker,
spoofable header check; the owner picked the uniform, more robust option.
Nothing to build here in `web-client-portal` itself — a 429 from this
endpoint surfaces through the existing `ApiError`/`errorMessage()` path
like any other login failure.

**Still not built**: the complaint-form rate limit (5/contact/hr +
20/IP/hr, spec §5.2) — waits on the complaint-form cluster itself (no
endpoint exists yet to gate).

**Deployed** (2026-08-31): Vercel project `web-client-portal` (team `meagency`), linked to this repo, root directory `web-client-portal`, same one-project-per-app pattern as `web-internal-mea`/`agency-app-api`. No env vars needed — the app only reads `BACKEND_URL`, which already falls back to the real `agency-app-api.vercel.app` in production.

**Served under `app.meagency.co.id/klien/*`** (2026-09-01 follow-up, owner decision — `docs/DECISIONS.md`), not its own domain: `basePath: '/klien'` here (`next.config.ts`) + a matching path rewrite in `web-internal/next.config.ts` (Next.js "multi zones" — the exact proxy technique this repo already uses for the `apps/api` backend, just fronting a second Next.js app instead). `web-client-portal.vercel.app` itself is still live and still works (Vercel domain, unchanged) — it's now also reachable at `app.meagency.co.id/klien/*` via the proxy. **Every route in this app moved** (`/klien/login`, `/klien/`, `/klien/akun/password`, `/klien/lupa-password`, `/klien/reset-password`) — `next/link`/`useRouter` handle the prefix automatically; the few plain `<a href>` tags that predate this were switched to `next/link` since a raw anchor is NOT basePath-aware. **Session cookie split**: since Client Portal now shares a host with `web-internal`, `apps/api` gives the client-contact realm its own cookie (`CLIENT_PORTAL_SESSION_COOKIE`, distinct from employee/vendor's `SESSION_COOKIE`) so an AM with an internal session open who also logs into the Portal in the same browser doesn't silently log one or the other out — see `apps/api/src/lib/auth.ts`'s doc comments on `CLIENT_PORTAL_SESSION_COOKIE`/`requireClientContactActor`.

**Infra prerequisites NOT satisfiable from this repo** (owner action):
self-service email reset needs SMTP configured on the Supabase project
(`CDPS SG`) plus the redirect URL added to the project's allowed list —
now that the Portal has a real domain path, that should be
`https://app.meagency.co.id/klien/reset-password` — the code path is
complete and correct, but no email actually sends until both are
configured.

## Separate auth realm (non-negotiable)

This app is CDPS's **third** non-HRIS Supabase Auth realm (after the
employee-local realm and the LT-61 vendor realm) — `client_contacts`
(migrations `20260905010000`/`20260905020000`), never mixed with
`employees`/`vendor_accounts`:

- Client contacts authenticate through their **own** realm — they are **never**
  part of the HRIS employee sync used by `web-internal` / the CDPS backend
  (`docs/HRIS_API_CONTRACT.md`, Phase 0 v2 §8).
- Session TTL is a custom 4-hour idle timeout (spec §3.5) — NOT the
  project-wide GoTrue default every other realm uses. Enforced at this app's
  layer (`src/lib/idle-timeout.ts`), never a change to the shared GoTrue
  project TTL.
- Data access is a **strict per-Client allow-list** enforced at the query layer
  (Module 15 §6.1) — **never** a permission-trimmed view of internal data.
  This applies to the surfaces not yet built (Service Progress, Health,
  reports, complaint form); the auth cluster itself has no such data surface.
- Rate limiting, session expiry, and per-contact action audit: see spec §5.

Do not wire this app to the internal auth/session tables or to `web-internal`'s
`auth-context.tsx`/`vendor-auth-context.tsx`.

## Development

```
npm install
npm run dev      # proxies /api/v1/* to apps/api (see next.config.ts)
npm test
npm run typecheck
```
