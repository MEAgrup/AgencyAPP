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

**Still not built, within the auth cluster itself**: the app-level per-IP
rate limits on login (10/IP/15min) and the future complaint form
(5/contact/hr + 20/IP/hr) — spec §5.2 OQ-5's numbers are decided, the
enforcing code is follow-up work (login's shared-endpoint architecture
— `apps/api`'s `/auth/login` serves employee/vendor/client-contact alike —
needs a deliberate design call on how to scope a Portal-only limit before
it's implemented; not done silently here). Login currently relies on
GoTrue's own protections only.

**Infra prerequisites NOT satisfiable from this repo** (owner action):
self-service email reset needs SMTP configured on the Supabase project
(`CDPS SG`) plus the `web-client-portal` deploy URL added to the project's
allowed redirect URLs — the code path is complete and correct, but no email
actually sends until both are configured.

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
