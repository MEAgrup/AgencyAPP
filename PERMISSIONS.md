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

> ### Audit trail scope — O46 RESOLVED 2026-07-30 (`docs/DECISIONS.md`)
> `audit_log` visibility follows the universal pattern literally, and the two edges matter:
> - **Staff = own entries only.** Scope is the entry's **actor**, not the entity it describes.
>   Consequence, stated deliberately rather than discovered later: an entity's history panel
>   (e.g. Creative Asset) is **partial** for a staff viewer — they see their own transitions,
>   not their lead's approval. That is PRD behaviour, not a defect. Making it whole is a PRD
>   change plus its own ticket, not an RLS patch.
> - **Lead/SPV = division-wide**, resolved from the **entry actor's** division. Added by migration
>   `20260730073000`; before it, a lead could not read their own division's trail at all.
>
> Enforced in the DB (`audit_log_select`), locked by `supabase/tests/rls_checks.sql` checks 21–23 —
> including a guard check that goes **red** if anyone widens staff beyond own-entries without a
> `DECISIONS.md` row. `audit_log` is append-only (trigger `audit_log_no_delete`); there is no write
> policy and no mutation path (house rule #3).
>
> ⚠️ **Known narrower-than-spec elsewhere: `O48`.** A survey of every `SELECT` policy found **36 of
> 45** carry no lead/division arm at all — including `assets_select` and `employees_select`, where a
> Lead/SPV cannot see their own division's rows. Direction is always **narrower**, so there is no
> leak; but until O48 is decided, "Lead/SPV = division-wide" above is **enforced for
> `transactions`/`audit_log` and aspirational for the rest.** Do not read this table as fully
> enforced house-wide.

## Per-module specifics (exceptions & named rights)
| Module | Rule |
|---|---|
| M0 Sales | Salesperson: own attempts only. **Negotiation approval: Superior (Sales Head/SPV) only.** Closing: Primary Salesperson; allocation Σ=100% enforced. |
| M1 Leads | Marketing imports (campaign must be `[Active]`); Sales claims/registers; bad-lead evaluation per M1 roles. |
| M2/M3 Marketing & Campaign | Marketing Staff: own campaigns/records only. Marketing Lead: all + **reassign campaign ownership**. Sales: read-only campaign label. Execution: read-only trace. |
| M4 Client Record | Locked identity fields: **correction only by Account Lead or OD**, logged. Baseline GMV correction: **OD only**. Target GMV/Marketing Budget: **Account**, logged. Sales PIC & Commission/Payment PIC reassign: **Sales Lead**, logged. Sales Staff: own clients only; allocation members get read-only visibility. |
| M5 Finance | **Only Finance sets authoritative Payment Status.** Pre-verification records visible to Finance only. `[Bermasalah]` resolution: **joint SPV Finance + SPV Account**, escalate Director on disagreement. |
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
