# O37 — Read-path authorization: RLS vs service-role (decision brief)

> Status: **RESOLVED / IMPLEMENTED 2026-07-24** — option (a)+(c) below was built
> (user directive "selesaikan 37"). Reads: `apps/api/src/lib/db.ts` `readAs(actor,…)`
> (SET LOCAL ROLE authenticated + inject `request.jwt.claims`); all user-facing GETs
> converted; finance-wide dashboards use the named `readAsSystem` path gated by
> `canReadDivision('Finance')`; owner/PIC names resolve via
> `employee_display_name()` SECURITY DEFINER (migration `20260102000006`). Verified
> on CDPS SG (staff→own, Director/OD→all) + `apps/api` `readAs` integration test +
> `rls_checks.sql`. Deploy note: the `DATABASE_URL` role must be able to
> `SET ROLE authenticated` (Supabase pooler role can). The rest of this brief is
> the original decision record.

## 1. The problem (what O37 flagged)

`apps/api/src/lib/db.ts` hands every route one shared Postgres client connected
via `DATABASE_URL`. Writes deliberately go through `SECURITY DEFINER` RPCs
(`ident_next` / `sm_transition` / `notify_emit` …) granted only to
`service_role`. But **reads run on that same privileged connection**, and
`service_role` is `BYPASSRLS` (`supabase/migrations/20260102000003_rls_baseline.sql:43`).
So on the read path:

- Row Level Security does **not** filter anything, and
- there is no app-layer scope check either (except where a domain read hand-writes
  one — e.g. the notifications inbox scopes by `recipient_employee_id = actor`,
  `packages/domain/src/notifications.ts`).

Net: an authenticated user calling a read endpoint can retrieve rows outside their
role scope (Pool board, Leads DB, other divisions' clients, …). It is a
cross-module gap, not a single-endpoint bug, and it blocks multi-role go-live
(controlled internal UAT can proceed).

## 2. What already exists (the decisive fact)

The RLS layer is **already built, granted, and test-passing** — it is simply
switched off by the connection role:

- RLS is enabled on **all 53 public tables**, `authenticated` is reset to
  `SELECT`-only, internal tables (sessions, credentials, role_mappings, machine
  config) are default-deny — `rls_baseline.sql:157-186`.
- Domain SELECT policies encode the exact Phase-0 §4 matrix (own / division /
  read-all / parent-owner) via `jwt_employee_id()`, `jwt_division()`,
  `jwt_is_lead()`, `jwt_can_read_all()` reading `request.jwt.claims`
  (`rls_baseline.sql:73-108`, policies `:207+`).
- `supabase/tests/rls_checks.sql` proves these policies match
  `packages/core/src/permission.ts` predicate-for-predicate. **This suite passes
  on a fresh migrated Postgres today** (verified locally this session, alongside
  ident/immutability/auth-claims invariants and the full 182-test domain suite).

The engagement mechanism is one transaction-local incantation (`rls_checks.sql:15-30`):

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"…","division":"…","level":"staff|lead","od":false,"director":false}}',
  true);   -- true = local to the transaction
-- …queries here run exactly as they will under Supabase Auth…
```

The route already has everything this needs: `apps/api/src/lib/auth.ts` verifies
the GoTrue JWT and resolves the Actor from `app_metadata` — the same five claims
the policies read. So the claims JSON is a re-serialization of data the request
already holds.

## 3. Options

### (a) RLS via per-request JWT claims — *turn on what's already there*

Reads open a transaction, `SET LOCAL ROLE authenticated`, inject the actor's
claims into `request.jwt.claims`, then query. Writes stay on the `service_role`
RPC path. True system/batch reads (below) stay explicitly on `service_role`.

- **Pros:** reuses the entire tested RLS layer — the single source of truth the
  project already maintains in three mirrors (SQL policies ↔ Go ↔
  `permission.ts`); **structural** defense-in-depth (a buggy or new route cannot
  over-read — the DB refuses); no per-endpoint scope code to write or keep in
  sync; satisfies CLAUDE.md #6 "every endpoint has permission tests" by
  construction; matches the original architecture intent (db.ts even calls RLS
  "the read safety net").
- **Cons / work:** every read must run inside a transaction with `SET LOCAL` on
  the transaction-mode pooler (`prepare:false` is already set, so compatible —
  adds one wrapping round-trip); the request-path **login role must be a member
  of `authenticated`** so it can `SET ROLE` to it (real Supabase provides
  `authenticator`; migrations here create `authenticated`/`service_role` only —
  a small infra/grant item that overlaps §3a); a handful of reads that are
  legitimately cross-scope must be **classified as system** and left on
  `service_role` on purpose (see §4).
- **Risk:** mislabeling a system read as user-scoped → empty results;
  the reverse → leak. Mitigated by a single named split (`readAs` vs `readAsSystem`).

### (b) App-layer scope gates in every read — *port Go `reads.go` predicates*

Keep the `service_role` connection; add an Actor-keyed scope predicate to each
domain read (`where owner = actor OR canReadAll(actor) OR division = …`),
porting `canReadPool` / `leadListScope` / … from the Go backend.

- **Pros:** no transaction wrapping, no role plumbing; explicit and debuggable in
  TS; trivial to special-case a specific read.
- **Cons:** duplicates scope logic that **already lives in RLS/SQL** — a *fourth*
  copy alongside SQL/Go/`permission.ts`, free to drift; every new read route is a
  fresh place to forget the gate — i.e. it re-creates exactly the failure mode
  O37 is about; per-endpoint permission tests become mandatory and hand-written
  for each read. Highest long-run maintenance, weakest guarantee.

### (c) Combination — RLS as the structural net, app-layer where RLS is coarse

Default reads run as `authenticated` (option a). A small, named set of reads add
an explicit app-layer check where finer/different logic is wanted; genuine
system/batch reads use `service_role` deliberately and are named as such.

- **Pros:** defense-in-depth + an escape hatch; least likely to leak.
- **Cons:** two mechanisms to understand; must document which read uses which.

## 4. Recommendation — **(a), with the (c) discipline of a named system path**

Default every read to `authenticated` + injected claims so RLS enforces scope;
route genuine cross-scope/system reads through an explicit, commented
`service_role` path. Rationale: the authorization layer is **already written and
test-covered**, so this is mostly *connection plumbing rather than net-new
security code*; it closes the "forgot the gate on a new endpoint" hole
structurally; and it avoids maintaining a fourth divergent copy of the scope
rules that option (b) implies. Option (b) only wins if provisioning an
`authenticated`-member login role is somehow blocked — in which case it becomes
the fallback.

### System reads to keep on `service_role` (audit as part of the change)

These are intentionally cross-scope and must NOT run as `authenticated`:

- `finance.scanReminders` — SYSTEM batch (already `SYSTEM_ACTOR`), writes across
  all clients.
- `finance.reminderDashboard` — finance-wide operational view (scope it by role,
  not by row-owner).
- any org-wide dashboard/rollup read (health, performance) when those land.

Everything user-facing (leads DB, pool, attempts, client record, transaction
detail, **notifications inbox**) runs as `authenticated`.

## 5. Implementation sketch if (a)/(c) is chosen — *not yet done*

1. **Role/infra (overlaps §3a):** ensure the request-path login role is a member
   of `authenticated` (`GRANT authenticated TO <app_login_role>`), or use
   Supabase's `authenticator`. Keep the `service_role` connection for writes +
   system reads.
2. **`apps/api/src/lib/db.ts`:** add
   ```ts
   export async function readAs<T>(actor: Actor, fn: (tx: Sql) => Promise<T>): Promise<T> {
     return db().begin(async (tx) => {
       const claims = JSON.stringify({ app_metadata: {
         employee_id: actor.employeeId, division: actor.role.division,
         level: actor.role.level, od: actor.role.od, director: actor.role.director,
       }});
       await tx`select set_config('request.jwt.claims', ${claims}, true)`;
       await tx`set local role authenticated`;
       return fn(tx);
     });
   }
   ```
   (claims shape verbatim from `rls_checks.sql:29-30`.)
3. **Routes:** switch user-facing GETs from `db()` to `readAs(actor, (tx) => domain.read(tx, …))`;
   leave writes (RPC) and the §4 system reads on `db()`, each with a one-line
   comment saying why it is service-role.
4. **Tests:** extend the existing `rls_checks.sql` parity net; add one
   "other-scope returns empty" case per converted route (this is how CLAUDE.md #6
   is satisfied for reads). The local Postgres recipe used this session (apply
   `supabase/migrations/*` in order, then `DATABASE_URL=… npm test`) runs them.

## 6. Interim posture (until decided)

FE wiring keeps working on service-role reads — **functional, but over-permissive
for an internal multi-role app**. Acceptable only for controlled internal UAT
with trusted accounts. Do not open to the full role set (or any external portal)
before O37 is resolved; the external Client Portal is a separate, stricter realm
and must never depend on this read path.
