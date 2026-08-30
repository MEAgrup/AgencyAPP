# CDPS — Module 10 Addendum: LT-61 Vendor Login Security Spec

> Forward requirement for LT-61 (`docs/backlog/LEADTIME_BACKLOG.md` Fase 5b),
> written in the style of `CDPS_Phase0_Foundation_v2.md` §11 (the equivalent
> minimum for Module 15's Client Portal). **This is the spec gate LT-61 was
> waiting on** (`docs/handoff/HANDOFF_LT60_SELESAI_LT61_SPEC_20260830.md`).
> Scope decisions in §0 were confirmed by the product owner 2026-08-30; the
> remaining items in §7 (Open) still need an answer before implementation
> starts. **No migration, `packages/domain`, or FE code for LT-61 should be
> written until §7 is empty and this file's status line below reads Approved.**

**Status: DRAFT — owner has confirmed scope (§0) but has not yet signed off
on the detailed mechanics below (§1–§6). Record the sign-off as a new
`docs/DECISIONS.md` Decided row before starting implementation.**

## 0. Scope decisions (owner, 2026-08-30)

Answered directly by the product owner when this session picked up the
LT-61 blocker documented in the 2026-08-30 handoff:

1. **This spec is independent of M15's Client Portal spec (`O5`).** LT-61
   does not wait for `O5` to be written or approved. The two problems are
   structurally identical (a first external, non-HRIS auth realm) but the
   vendor's data surface is far narrower than the full Client Board, so
   they are allowed to proceed on separate timelines.
2. **Auth realm: a real Supabase Auth account per vendor user** — not the
   login-less `strategi_share_token`/`/s/{token}` pattern (2026-08-09
   precedent). The vendor gets an actual login, kept in a realm that is
   structurally separate from the HRIS-synced `employees` population (§1).
3. **Write scope: the vendor fills Live Stream Session (`LSS-`) result
   fields directly.** This replaces the AM re-typing a vendor-supplied
   report into `logResults` (`packages/domain/src/livestream.ts`) — the
   vendor becomes the actor for the **result-entry edge** of the `LSS-`
   machine. It does **not** touch reconciliation (§4 below pins the exact
   edge boundary).

## 1. Auth realm

- Vendor users are **not** rows in `employees` and **never** flow through
  HRIS sync. They must never acquire `app_metadata.employee_id` — that
  claim is the single load-bearing assumption of `packages/core/src/permission.ts`
  (`Actor.employeeId`, `actorFromClaims` throws on an empty one) and of
  every `jwt_*` RLS helper. Do not attempt to satisfy LT-61 by inserting a
  synthetic `employees` row for a vendor — that reuses the wrong population
  and would make a vendor indistinguishable from staff everywhere else in
  the system (permission matrix, roster, notifications, performance).
- Concretely: a new `vendor_accounts` table (Supabase Auth `user_id` →
  `vendor_id` FK to `vendors`, per-account `status_aktif`), and a
  **second, separate branch** in `public.custom_access_token_hook`
  (`supabase/migrations/20260723071013_supabase_auth.sql`) — or a second
  hook function, whichever keeps the employee branch untouched — that
  looks up `vendor_accounts` instead of `employees`/`role_mappings` and
  stamps `app_metadata.vendor_id` (never `employee_id`, never `division`).
  The employee branch's behavior must be provably unchanged (regression
  test: an employee token's claims are byte-identical before/after this
  hook is extended).
- A brand-new `VendorActor` type lives beside `permission.Actor`, never
  merged into it. Route handlers that serve vendor-facing endpoints resolve
  a `VendorActor` and pass it only into the new vendor-facing domain
  functions in §4 — they must be physically incapable of reaching any
  route or domain function gated on `permission.Actor`.
- Same Supabase project (`CDPS SG`) is fine — "separate realm" here means
  a separate claim shape, separate RLS policies, and a separate actor type
  in code, not a second Supabase project. (Flag if the owner intended a
  literally separate project; not assumed here.)

## 2. Data isolation

- **Gap found while writing this spec:** no table today links a Live
  Stream Brief or Session to a specific `vendors.id`. `vendor_id` only
  exists on `strategi_pillar`/`strategi_resource` (`20260806064000_m6a_strategi.sql`,
  the pillar/resource assignment, CHECK-restricted to `jenis='live'`) — it
  is a **live, editable** assignment on the client's strategy, not a
  stable fact stamped on a Brief. LT-61 needs the latter: a `vendor_id`
  column on `live_stream_sessions` (or on the parent Brief — pick one,
  Session is more precise since a recurring Brief could in principle
  change vendors between periods) that is **stamped once at creation and
  never edited**, same immutability pattern as `data_confidence_tier`.
- **Open question this raises:** at Session-creation time, is the
  `vendor_id` copied from the client's current `strategi_pillar` (`jenis='live'`)
  row, or does the owning AM pick it explicitly on the request form? Either
  is workable; the spec needs the owner/head-dev's steer per the house rule
  that requires all cross-module FK sourcing decisions to be explicit, not
  inferred by whoever implements it.
- RLS: a new `jwt_vendor_id()` helper (mirrors `jwt_division()`/`jwt_is_lead()`
  in shape, **kept in a clearly vendor-only naming lane** — never merged
  into the `jwt_division`/`jwt_is_lead` family those helpers' callers
  already assume means "an employee"). New policy on `live_stream_sessions`:
  a vendor-realm JWT may `SELECT`/`UPDATE` only rows where
  `vendor_id = jwt_vendor_id()`, and only via the narrow update path in §4
  (never a raw table-level UPDATE grant — the state machine still owns the
  status column per house rule #2).
- The vendor never sees the parent Brief's full record (client name may be
  visible per Brief; other financial/strategy fields must not be) — the
  read surface is a **new vendor-facing read model**, not a permission-
  trimmed reuse of the internal `getSession`/`listBriefSessions` shape
  (same principle `web-client-portal/README.md` states for the Client
  Portal: "never a permission-trimmed internal view").

## 3. Audit trail for a non-employee actor

- `audit_log.actor_employee_id` is `varchar(64) NOT NULL` with **no
  physical FK** to `employees` (`20260722053824_init.sql`) — so it can
  hold a non-employee identifier without a schema change, but every
  existing reader of this column assumes an `employees.employee_id` join
  works. Recommend a new nullable `actor_type` column (`'employee'` default
  vs `'vendor'`) alongside a vendor-distinguishable value in
  `actor_employee_id` (e.g. the `vendor_accounts` id, never colliding with
  an `EMP-`-shaped id) — additive only; the table's existing
  no-UPDATE/no-DELETE triggers are untouched and every historical row
  keeps reading exactly as it does today.
- Every vendor action (result submission, and anything else granted under
  §4) gets its own immutable `audit_log` row exactly like an employee
  action — no exception to house rule #3.

## 4. Write scope — pinned to one edge

- **In scope:** `logResults` (`[Confirmed by Vendor]` → `[Completed]`,
  `packages/domain/src/livestream.ts`) becomes reachable by the owning
  vendor (`session.vendor_id === actor.vendorId`), in addition to the
  existing owning-AM/Director gate — **additive**, the AM/Director path is
  never removed (an AM must still be able to log results on the vendor's
  behalf when the vendor doesn't self-serve, e.g. a one-off vendor without
  an account yet).
- **Explicitly out of scope**, all remaining unchanged (owning AM/Director
  only, per `canManageSession`):
  - `confirmByVendor` (`[Requested]` → `[Confirmed by Vendor]`) — schedule
    confirmation stays AM-entered. (Flagged as an open question below —
    the owner's answer covered "session results," not schedule
    confirmation; do not fold this edge in without asking.)
  - `reconcile` / `flagDiscrepancy` (`[Completed]` → `[Reconciled]` /
    `[Discrepancy Flagged]`) — reconciliation is inherently the AM
    checking the vendor's own numbers; a vendor reconciling itself defeats
    the purpose of the machine as documented in `livestream.ts`'s header
    ("what the vendor actually delivered" vs. "what MEA requested" — two
    independent sides of the same check).
  - `createSession`, `reopenBrief` — vendor never initiates a request or
    reopens a Brief.
- Field-level validation for the vendor-submitted result (mandatory
  `actualDatetime`/`actualDurationHours`/`ordersGenerated`/`gmv`/
  `vendorReportLink`, exact same BI `[...]` messages) is unchanged from
  `logResults` today — the vendor hits the same validation, just as a
  different actor.

## 5. Rate limiting

- Vendor login must be rate-limited per the same minimum Phase 0 v2 §11
  sets for Client Portal login (Supabase Auth's built-in limits are the
  floor; add an app-layer throttle on the vendor login route if the
  vendor's login page is public-facing, matching whatever mechanism gets
  chosen for M15 login when that spec is written — do not invent a second
  mechanism if one already exists by then).
- No complaint-form-equivalent exists on this surface, so §11's second
  rate-limit target does not apply here.

## 6. Session expiry

- Recommend **shorter than the internal employee session TTL** (external
  realm, occasional usage pattern — a vendor logs in around scheduled live
  sessions, not daily). Exact TTL is an **Open** item (§7) — needs the
  same number the owner would pick for M15, or its own number if M15
  hasn't set a precedent yet by the time LT-61 implements.

## 7. Open (must be answered before implementation)

| # | Question | Needed from |
|---|---|---|
| 1 | Does the vendor also get `confirmByVendor` (schedule confirmation), or only `logResults` (result entry)? §4 currently pins ONLY `logResults` because that's the literal scope the owner confirmed 2026-08-30 — confirm or extend. | Owner |
| 2 | `vendor_id` on `live_stream_sessions`: copied from `strategi_pillar` (`jenis='live'`) at creation, or picked explicitly by the AM on the request form? | Owner / head dev |
| 3 | Exact vendor session TTL. | Owner |
| 4 | Does the vendor's Supabase Auth account get provisioned by a Director-only admin screen (mirrors employee onboarding) or a one-off manual insert given the vendor count is tiny (per handoff §4 point 1, "kemungkinan sangat sedikit")? | Owner / head dev |

## 8. Reference

- `docs/handoff/HANDOFF_LT60_SELESAI_LT61_SPEC_20260830.md` — the handoff
  that raised this blocker and its question framework (§4 there maps to
  §0/§1–§6 here).
- `packages/domain/src/livestream.ts` — `LSS-` machine, `canManageSession`,
  `logResults`/`confirmByVendor`/`reconcile`/`flagDiscrepancy`.
- `packages/core/src/permission.ts` — `Actor`/`Role`, the closed
  employee-only assumption this spec deliberately does not touch.
- `supabase/migrations/20260723071013_supabase_auth.sql` — `custom_access_token_hook`.
- `supabase/migrations/20260806063000_m6a_vendor.sql`,
  `20260806064000_m6a_strategi.sql` — `vendors` master record,
  `strategi_pillar.vendor_id`/`strategi_resource.vendor_id` (the only
  existing vendor-identity FK in the schema today).
- `docs/prd/CDPS_Phase0_Foundation_v2.md` §11 — the M15 minimum this
  addendum mirrors.
- `web-client-portal/README.md` — the separate-realm / allow-list contract
  already agreed for Client Portal; §2/§4 here follow the same shape.
