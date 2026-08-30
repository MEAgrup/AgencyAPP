# CDPS — Consolidated Permission Matrix

> Compiled from Phase 0 §4 + every module's Roles table. Phase 0 prevails on conflict. This file drives the permission test suite (CLAUDE.md DoD #2). Universal pattern: **Staff = own data; Lead/SPV = division-wide; OD = read-only everywhere + manages OKR; Director = full view + manage employees.** OD/Director are layered roles on a normal employee account.

## Global
| Capability | Staff | Lead/SPV (own div) | OD | Director |
|---|---|---|---|---|
| View own records/tasks | ✅ | ✅ | ✅ (read-all) | ✅ |
| View division-wide | ❌ | ✅ | ✅ read-only | ✅ |
| View cross-division / all clients | ❌ | ❌ (see notes) | ✅ read-only | ✅ |
| Edit auto-computed fields | ❌ nobody — system only | ❌ | ❌ | ❌ |
| Manage OKR | ❌ | ❌ | ✅ | ✅ |
| Manage employees / role mapping | ❌ | ❌ | ❌ | ✅ (+ system admin) |
| Read audit trail | ✅ **own entries only** | ✅ own division (by entry's actor) | ✅ read-all | ✅ read-all |

> ### Audit trail scope — O46 decided, fixed, applied, and VERIFIED live 2026-07-30 (`docs/DECISIONS.md`)
> `audit_log` visibility follows the universal pattern literally, and the two edges matter:
> - **Staff = own entries only.** Scope is the entry's **actor**, not the entity it describes.
>   Consequence, stated deliberately rather than discovered later: an entity's history panel
>   (e.g. Creative Asset) is **partial** for a staff viewer — they see their own transitions,
>   not their lead's approval. That is PRD behaviour, not a defect. Making it whole is a PRD
>   change plus its own ticket, not an RLS patch.
> - **Lead/SPV = division-wide**, resolved from the **entry actor's** division. Added by migration
>   `20260730091540` and made to actually fire by `20260730120433`; before them, a lead could not
>   read their own division's trail at all.
>
> ✅ **This row IS true in production, and that was proven by probe rather than assumed.**
> `20260730091540` shipped **dead**: it compared `employees.divisi` (an **HRIS department**, `SALES`)
> against `jwt_division()` (a **CDPS division**, `Sales`) — two vocabularies bridged by
> `role_mappings` — so `EXISTS(...)` was always false and both lead arms never fired. A read-only
> probe of live found it; the local tests did **not**, because their fixture used the CDPS spelling
> and so matched by coincidence. `20260730120433_fix_o46_division_resolution.sql` resolves both sides
> through `public.employee_claims()` — the same function that populates the JWT claims, so the two
> sides cannot diverge again. It was **applied to live `CDPS SG` 2026-07-30 12:04 UTC** and the
> post-apply probe (8 scenarios, both controls green) confirms the arm now fires: Sales lead
> `2101180004` reads **36** division rows where own-only would be **32**, cross-division Creative lead
> still reads **0**, and Sales **staff** still reads **0**.
>
> The `jwt_division() <> ''` guard in that migration is **load-bearing, not defensive tidiness**:
> **7** live employees currently resolve to an empty division, so without it any empty-division lead
> would match all of them. Probed: empty-division lead reads **0**.
>
> Enforced in the DB (`audit_log_select`), locked by `supabase/tests/rls_checks.sql` checks 21–23 —
> including a guard check that goes **red** if anyone widens staff beyond own-entries without a
> `DECISIONS.md` row. `audit_log` is append-only (trigger `audit_log_no_delete`); there is no write
> policy and no mutation path (house rule #3).
>
> ⚠️ **Known narrower-than-spec elsewhere: `O48`.** A survey of every `SELECT` policy found **36 of
> 45** carry no lead/division arm at all — including `assets_select` and `employees_select`, where a
> Lead/SPV cannot see their own division's rows. Direction is always **narrower**, so there is no
> leak; but until O48 is decided, "Lead/SPV = division-wide" above carries an arm **only on
> `transactions`/`audit_log`, and is aspirational for the rest.** Do not read this table as fully
> enforced house-wide.
>
> 🟠 **Update 2026-07-30 — the survey number itself was off, and O48 is now partly decided.**
> Re-measured against live: **35 of 45** carry no lead/division arm (not 36), **10** do (not 9), and
> **3 of the 35 are deliberately not division-scoped** (`notifications` is personal by design;
> `master_services`/`master_service_versions` are the public MSL catalog) — so the real candidate
> count is **32**. Full classification: `docs/handoff/O48_ANALISIS_KEPUTUSAN.md`.
>
> **Grup C + D (6 policy) were decided and implemented** — migration `20260730160000`,
> **not yet applied to live**. Grup D matters most: four M14 routes read through `readAsActor`, so
> RLS actually bites, and `GET /performance/teams/{division}` was averaging only the rows that
> survived RLS and rendering that as the **team** average — a wrong number that looks right, not an
> empty page. Grup A/B/E remain **open**. Until `20260730160000` is live, the M14 rows in the table
> above are aspirational.
>
> **36 of 45 is the correct figure again as of `20260730120433` being live.** Between
> `20260730091540` and that fix it was briefly **45 of 45**: the arm existed in both policies' text
> but resolved division through the wrong vocabulary, so it never fired. That interval is worth
> keeping on the page because of what it exposed — **the O48 survey counts policy TEXT, not whether
> the arm actually fires.** A future survey that recounts text alone will make the same mistake; the
> only thing that distinguished 36 from 45 was a probe against live data.
>
> ⚠️ **One caveat on the evidence, stated rather than left implicit:** the probe exercised the
> `audit_log` arm against real rows. `transactions` is **empty in live (0 rows)**, so its arm is
> verified only by the shared helper (`private.jwt_division_owns_client`, same
> `employee_claims()` resolution, unit-covered by `rls_checks`) and **not** by live data. Re-probe it
> once transactions exist.

## Per-module specifics (exceptions & named rights)
| Module | Rule |
|---|---|
| M0 Sales | Salesperson: own attempts only. **Negotiation approval: Superior (Sales Head/SPV) only.** Closing: Primary Salesperson; allocation Σ=100% enforced. **Kinerja Sales dashboard (§7.1, 2026-08-30):** Sales staff = own row only; Sales Head/SPV = **division-wide** (`salesperf.scopeFor`), backed since S-01 by RLS arms on `prospect_attempts_select`/`clients_select`/`installments_select` (`jwt_is_lead() AND jwt_division()='Sales'`, or the `origin_division` twin on `prospect_attempts_select`) — before S-01 a Sales lead reading through `readAsActor` saw only their own rows, silently. `transactions_select` needed no new arm (already division-wide via O46's `jwt_division_owns_client`). **Sales OKR (`sales_targets`):** read = owner / Sales lead-SPV / OD / Director; write = Sales lead-SPV, OD, or Director (`salesperf.canManageTarget`) — a pure-staff Sales account cannot set a target, including their own. |
| M1 Leads | Marketing imports (campaign must be `[Active]`); Sales claims/registers; bad-lead evaluation per M1 roles. **Leads Database terbuka untuk Sales di semua level** (keputusan pemilik 2026-08-06): gate endpoint mengizinkan, RLS `leads_select` yang mempersempit — staff hanya lead yang ia daftarkan / ia pegang. Pool tetap `[Pool]` saja; lead scouted eksklusif (M1 §6 rule 3). **Log aktivitas (`ACT-`)**: menulis = pemilik attempt / Sales Lead / Director (`canWriteAttempt`); membaca = kembar `prospect_attempts_select` (pemilik, penulis, Head sedivisi, OD/Director). Append-only untuk semua peran, termasuk Director. |
| M2/M3 Marketing & Campaign | Marketing Staff: own campaigns/records only. Marketing Lead: all + **reassign campaign ownership**. Sales: read-only campaign label. Execution: read-only trace. |
| M4 Client Record | Locked identity fields: **correction only by Account Lead or OD**, logged. Baseline GMV correction: **OD only**. Target GMV/Marketing Budget: **Account**, logged. Sales PIC & Commission/Payment PIC reassign: **Sales Lead**, logged. Sales Staff: own clients only; allocation members get read-only visibility. |
| M5 Finance | **Only Finance sets authoritative Payment Status.** Pre-verification records visible to Finance only. `[Bermasalah]` resolution: **joint SPV Finance + SPV Account**, escalate Director on disagreement. **Transaction change (scheme/schedule): SPV/Head Finance FILES, only a Director APPROVES** — approval is what applies it (M5-OA-7, owner decision 2026-08-04). Finance staff cannot file; Sales/Account cannot even read the approval queue. |
| M6 Account | AM: assigned clients; Account Lead: all. AM assignment: **manual by SPV**. Strategy approval gate per M6. Complaint logging: AM (WhatsApp door) / Sales / Portal contact. |
| M7/M8/M9 Execution | PIC: own Assets/Bookings/Brief-as-task. Review/approve: AM/Team Leader per module. KOL escalation final call on disagreement: **SPV/Head Account**. |
| M10 Live Stream | AM creates/reconciles Sessions; SPV owns vendor follow-up; vendor has **no access**. |
| M11 Board | **Dependency create: AM or SPV/Account Lead only** (not division staff). Client Board: AM/SPV/OD/Director all clients; Staff only Clients where they're a PIC. |
| M12 Tasks | **`[Blocked]` transition: SPV/Lead only**; staff/AM submit block requests. SLA Target set at breakdown by Team Leader/SPV. |
| M13 Health | Visibility: AM/SPV/OD/Director. **Not client-facing** except band label via M15. ROAS toggle: AM/SPV per client. |
| M14 Performance | Staff: own score (always with full breakdown); Leader/SPV: team; OD/Director: everyone. KPI weight config: **admin UI** (Yohan/HR-level). |
| M15 Portals | Client contacts: strict allow-list only (Service Progress relabeled, embedded reports, Health band, complaint form). **Block-approval queue: SPV/Lead.** Management Dashboard: Director/OD/management, read-only. |

## Test-suite note
For every endpoint, generate cases: (allow) the named role, (deny) one role below it, (deny) cross-division same-level, (allow-read-only) OD, (allow) Director. Layered-role case: one fixture employee who is Staff+OD must get write access from Staff scope and read access from OD scope, never write from OD.
