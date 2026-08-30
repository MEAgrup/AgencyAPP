# CDPS — Module 10 Addendum: LT-61 Vendor Login Security Spec

> Forward requirement for LT-61 (`docs/backlog/LEADTIME_BACKLOG.md` Fase 5b),
> written in the style of `CDPS_Phase0_Foundation_v2.md` §11 (the equivalent
> minimum for Module 15's Client Portal). Raised by
> `docs/handoff/HANDOFF_LT60_SELESAI_LT61_SPEC_20260830.md`.

**Status: IMPLEMENTED (core + FE) 2026-08-30.** Auth realm, data model, and the
`packages/domain`/`apps/api` write/read gates are built and tested (§9). The
vendor-facing FE (`web-internal` `/vendor/*` route group) is now built too —
see §5/§8 and `docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md`.

## 0. Scope decisions (owner)

Round 1 (2026-08-30, via `AskUserQuestion` after the handoff):

1. **This spec is independent of M15's Client Portal spec (`O5`).** LT-61
   does not wait for `O5`. The two problems are structurally identical (a
   first external, non-HRIS auth realm) but the vendor's data surface is far
   narrower than the full Client Board, so they proceed on separate timelines.
2. **Auth realm: a real Supabase Auth account per vendor user** — not the
   login-less `strategi_share_token`/`/s/{token}` pattern (2026-08-09
   precedent). Structurally separate from the HRIS-synced `employees`
   population (§1).
3. **Write scope: the vendor fills Live Stream Session (`LSS-`) result
   fields directly** (`logResults`) instead of the AM re-typing a
   vendor-supplied report.

Round 2 (2026-08-30, answering §7's 4 mechanical questions):

1. **The vendor ALSO gets `confirmByVendor`** (schedule creation/confirmation)
   — not only `logResults`. Concretely: *"Vendor pihak yang membuat jadwal,
   dan AM yang memberikan info jadwal ke klien"* — the vendor is now the
   party that sets the Session's request/schedule fields
   (`createSession`), and the AM's role for scheduling becomes relaying
   that schedule to the client (out-of-system; no new CDPS state for this).
   `createSession`'s owning-AM/Director gate is therefore ALSO extended,
   additively, to the assigned vendor (§4).
2. **`vendor_id` sourcing: recommendation (a) accepted** — copied
   automatically from the client's Aktif Strategi `live` pillar
   (`strategi_pillar.vendor_id` where `jenis='live'`), not picked manually
   by the AM. Known, documented limitation: a client is assumed to have AT
   MOST ONE live-stream vendor at a time (§2).
3. **Session expiry: same as an employee session** — *"Vendor tetap login
   sepanjang hari"* (stays logged in all day, like a normal work session).
   No shorter TTL, no new mechanism (§6).
4. **Provisioning: recommendation accepted** — manual insert into
   `vendor_accounts`, no admin UI (vendor count is tiny; build a screen only
   if that stops being true).

## 1. Auth realm

- Vendor users are **not** rows in `employees` and **never** flow through
  HRIS sync, and never acquire `app_metadata.employee_id`.
- **Design actually used** (simpler than the round-1 draft's "brand-new
  `VendorActor` type" idea): a vendor Actor reuses the SAME
  `permission.Actor` shape as an employee, with:
  - `employeeId = vendors.id` (e.g. `"VND-202608-0001"`) — non-empty,
    human-legible in `audit_log`, and guaranteed disjoint from HRIS
    employee ids by prefix convention. This satisfies `sm_transition`'s
    non-empty-actor requirement and `audit_log.actor_employee_id`'s
    `NOT NULL` with **zero schema change** to that table (it already has no
    physical FK to `employees` — `20260722053824_init.sql`).
  - `vendorId = vendors.id` (same value, explicit field) — the ONLY thing
    any gate checks to recognize a vendor Actor (`permission.isVendorActor`).
  - `role = makeRole({})` — every field empty/false.

  Because every OTHER gate in the codebase keys off `role.division`/
  `role.director`/`role.od`/`isLead`, a vendor Actor is a silent no-op
  everywhere except the few call sites that explicitly check `vendorId`
  (`packages/domain/src/livestream.ts`). No new actor type, no new plumbing
  through the route/domain layers — `confirmByVendor(sql, actor, id)` takes
  the exact same `Actor` whether `actor` is an employee or a vendor.
- Built: `vendor_accounts` table (Supabase Auth `auth_user_id` PK →
  `vendor_id` FK, `status_aktif`) + `vendor_claims(uuid)` resolver + a second
  branch in `public.custom_access_token_hook` that tries `employees` first
  (untouched — same body, same order) and falls back to `vendor_accounts`,
  injecting ONLY `vendor_id`. Migration:
  `supabase/migrations/20260903010000_lt61_vendor_auth.sql`.
- `packages/core/src/permission.ts`: `actorFromVendorClaims(claims)` (mirrors
  `actorFromClaims`, throws on missing `vendor_id`). `apps/api/src/lib/auth.ts`
  `requireActor`/`actorFromToken` tries the employee mapping first, falls
  back to the vendor mapping — one unified entry point, no separate
  "vendor routes".
- Same Supabase project (`CDPS SG`) — "separate realm" means a separate
  claim shape, separate RLS policies, and (now) a separate Actor field, not
  a second Supabase project.

## 2. Data isolation

- **Gap found while writing this spec, now closed:** `live_stream_sessions.vendor_id`
  (nullable `varchar(32)` FK to `vendors`) is stamped ONCE at Session
  creation (`packages/domain/src/livestream.ts` `resolveLiveVendorId`) from
  the client's Aktif Strategi `live` pillar, and never written again by any
  UPDATE path — same immutability pattern as `data_confidence_tier`.
  `resolveLiveVendorId` picks the most recently touched `live` pillar row
  when more than one exists (`order by updated_at desc limit 1`) rather than
  erroring — **a genuinely multi-vendor-per-client live setup (e.g. one
  vendor per channel) is a known, accepted limitation, not solved here.**
  A Session created before the client had an Aktif Strategi `live` pillar
  gets `vendor_id = null` — the pre-LT-61, AM-only path keeps working
  exactly as before for it.
- RLS: `jwt_vendor_id()` helper (mirrors `jwt_division()`'s shape, kept in
  its own naming lane) + `live_stream_sessions_select` amended to also allow
  `vendor_id IS NOT NULL AND vendor_id = jwt_vendor_id()`. This is
  read-side defense in depth only — writes go through `db()` (privileged
  service role, RLS bypassed) + the TS gate, per `DECISIONS.md` O37; the RLS
  amendment does not change that for this table.
- **Read surface, as actually built:** the vendor reads the SAME `Session`
  shape (`getSession`/`listBriefSessions`, now also `listVendorSessions` for
  a vendor with no Brief id in hand) as the AM/Director path — no bespoke
  vendor read model was built. This satisfies the isolation intent without
  extra surface because `Session` already excludes the Brief/Client/
  financial context (it carries only `briefId` as an opaque string, no
  joined client name, no money fields outside this Session's own GMV) —
  unlike the Client Portal's much wider Client Board, there was nothing left
  to trim.

## 3. Audit trail for a non-employee actor

- **Resolved simpler than the round-1 draft assumed:** no schema change to
  `audit_log` was needed. `sm_transition`'s `p_actor_employee_id` parameter
  is passed through as-is from `Actor.employeeId` — a vendor Actor's
  `employeeId` already holds its `vendors.id`, which is non-empty,
  human-legible, and safe (no `actor_type` column was added; that idea from
  the earlier draft is superseded).
- Every vendor action gets its own immutable `audit_log` row exactly like an
  employee action — no exception to house rule #3.

## 4. Write scope

Per round-2 decision #1, the vendor's write scope is **create + confirm +
log results** — everything up to `[Completed]`, never reconciliation:

- **In scope, additive to the existing owning-AM/Director gate** (the AM
  path is NEVER removed — needed when a vendor has no CDPS account yet):
  - `createSession` (`[Requested]` birth) — the vendor now sets the request/
    schedule fields itself. Gated by `canVendorWriteSession(actor,
    resolveLiveVendorId(...))`, resolved from the Brief's client BEFORE the
    gate check (the Session doesn't exist yet to carry its own `vendor_id`).
  - `confirmByVendor` (`[Requested]` → `[Confirmed by Vendor]`).
  - `logResults` (`[Confirmed by Vendor]` → `[Completed]`) — same mandatory
    fields/BI messages as before, just reachable by a second actor.
- **Out of scope, unreachable by construction:**
  - `reconcile` / `flagDiscrepancy` (`→ [Reconciled]` / `[Discrepancy
    Flagged]`) — the AM checking the vendor's own numbers is the entire
    point of the machine. `edge()` (the shared transition driver) takes an
    explicit `allowVendor` opt-in per call site; `reconcile`/
    `flagDiscrepancy` never pass it, so no future edit to
    `canVendorWriteSession` can accidentally open these two.
  - `reopenBrief` — vendor never reopens a Brief.

## 5. Rate limiting

- **Decided 2026-08-30 (owner, `AskUserQuestion` when the FE was built):**
  rely on Supabase Auth's own default login rate limiting — no CDPS-side
  mechanism (no counter table, no in-memory limiter). M15's Client Portal is
  free to pick the same or a different mechanism independently; this is not
  a shared component.

## 6. Session expiry

- Per round-2 decision #3: same as an employee session — the existing
  GoTrue project default. No new mechanism, no per-realm TTL.

## 7. Provisioning

- Per round-2 decision #4: manual `INSERT INTO vendor_accounts` (pairing a
  Supabase Auth user, created via the Dashboard or the Admin API, with a
  `vendors.id`). No admin screen — revisit only if vendor count stops being
  tiny.

## 8. What was NOT built (explicitly out of scope)

- An admin UI for vendor account provisioning (§7).
- Solving the multi-vendor-per-client case (§2).

## 9. Built (reference)

- `supabase/migrations/20260903010000_lt61_vendor_auth.sql` — `vendor_accounts`,
  `live_stream_sessions.vendor_id`, `vendor_claims`, the hook's vendor
  branch, `jwt_vendor_id()`, the amended `live_stream_sessions_select` policy.
- `packages/core/src/permission.ts` — `Actor.vendorId`, `isVendorActor`,
  `actorFromVendorClaims` (+ `permission.test.ts` coverage).
- `packages/domain/src/livestream.ts` — `canVendorWriteSession`,
  `resolveLiveVendorId`, `edge()`'s `allowVendor` opt-in,
  `createSession`/`confirmByVendor`/`logResults` extended,
  `listVendorSessions`, `listVendorBriefs` (FE brief-discovery gap fix, see
  handoff §3.2) (+ `livestream.test.ts` "LT-61: vendor self-service" and
  "listVendorBriefs").
- `packages/domain/src/auth.ts` — `getVendorMe` (the vendor `/me` read model,
  parallel to `getMe`; + `auth.test.ts` coverage incl. under real RLS).
- `apps/api/src/lib/auth.ts` (`requireActor` vendor fallback), `db.ts`
  (`actorClaims` vendor branch), `wire.ts` (`SessionWire.vendor_id`,
  `VendorBriefWire`).
- **Login fix (2026-08-30):** `POST /auth/login` branches on
  `permission.isVendorActor` — before this, a vendor with a correct password
  still got a 401, because the route unconditionally ran `auth.getMe`
  (an `employees` lookup) regardless of actor kind. See
  `docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md` §2 for the
  exact failure trace.
- New routes: `GET /api/v1/vendor/sessions` (core), `GET /api/v1/vendor/me`,
  `GET /api/v1/vendor/briefs` (2026-08-30).
- **`GET /vendor/briefs` reads via `db()`, not `readAsActor`** — the SELECT
  policies on `briefs`/`services`/`clients`/`strategi`/`strategi_pillar` are
  all keyed on an employee claim, so under real RLS they evaluate false for
  every vendor and the read would come back silently empty even for a
  legitimately assigned vendor. `listVendorBriefs` already re-verifies
  ownership per row in TS (`resolveLiveVendorId`), so `db()` costs no
  authorization — same shape as the `recap.ts` precedent
  (`DECISIONS.md` 2026-08-14, M6D D-09b). Proven red-then-green in
  `livestream.test.ts` via `withClaims`. `GET /vendor/me` stays on
  `readAsActor`: `vendors_select` is `TO authenticated USING (true)`
  (open master data, same policy `vendor.getVendor` already relies on for
  employees), also proven under `withClaims` in `auth.test.ts`.
- `web-internal/src/lib/livestream.ts` — `Session.vendor_id`, `VendorBrief`,
  `listVendorSessions`/`listVendorBriefs`; `web-internal/src/lib/types.ts` —
  `VendorProfile`/`VendorMeResponse`; `web-internal/src/lib/vendor-auth-context.tsx`
  — the vendor realm's own auth context (separate from `auth-context.tsx`,
  own `/vendor/me` read model, own sessionStorage key).
- `web-internal/src/app/vendor/**` — the FE itself: `layout.tsx` (guard +
  minimal header, no Sidebar/internal nav), `login/page.tsx`, `page.tsx`
  (Session list), `sessions/new/page.tsx` (create — Brief picker via
  `listVendorBriefs`), `sessions/[id]/page.tsx` (confirm + log-results;
  deliberately does NOT fetch the parent Brief, unlike the internal
  equivalent — `GET /briefs/{id}` gates on employee-only reads).
- Table-count gates bumped 133→134 (`scripts/db-rebuild.sh`, `.github/workflows/ci.yml`)
  — `vendor_accounts` only; zero new prefix/machine/notif event. The FE pass
  added zero migrations (134/37/30/67 unchanged).

## 10. Reference

- `docs/handoff/HANDOFF_LT60_SELESAI_LT61_SPEC_20260830.md` — the handoff
  that raised this blocker and its question framework.
- `packages/domain/src/livestream.ts` — `LSS-` machine.
- `packages/core/src/permission.ts` — `Actor`/`Role`.
- `supabase/migrations/20260723071013_supabase_auth.sql` — `custom_access_token_hook`
  (employee branch, untouched by this addendum).
- `supabase/migrations/20260806063000_m6a_vendor.sql`,
  `20260806064000_m6a_strategi.sql` — `vendors` master record,
  `strategi_pillar.vendor_id`.
- `docs/prd/CDPS_Phase0_Foundation_v2.md` §11 — the M15 minimum this
  addendum mirrors.
- `web-client-portal/README.md` — the separate-realm contract already
  agreed for Client Portal.
