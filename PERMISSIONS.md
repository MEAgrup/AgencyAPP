# CDPS — Consolidated Permission Matrix

> Compiled from Phase 0 §4 + every module's Roles table. Phase 0 prevails on conflict. This file drives the permission test suite (CLAUDE.md DoD #2). Universal pattern: **Staff = own data; Lead/SPV = division-wide; OD = read-only everywhere + manages OKR; Director = full view + manage employees.** OD/Director are layered roles on a normal employee account.
>
> **Viewer** is a third layered role (added 2026-07-11 for the Data & Business Intelligence team, per Nerissa's decision — "buatkan akses khusus supaya bisa view dan membantu team lain"): read-only everywhere, same read reach as OD (own data + division-wide + cross-division/all clients), but **without OD's OKR authority** and without any lead/write/admin authority. It is assigned per person via the same layered-role mechanism as OD/Director, never bundled with them.

## Global
| Capability | Staff | Lead/SPV (own div) | OD | Viewer | Director |
|---|---|---|---|---|---|
| View own records/tasks | ✅ | ✅ | ✅ (read-all) | ✅ (read-all) | ✅ |
| View division-wide | ❌ | ✅ | ✅ read-only | ✅ read-only | ✅ |
| View cross-division / all clients | ❌ | ❌ (see notes) | ✅ read-only | ✅ read-only | ✅ |
| Edit auto-computed fields | ❌ nobody — system only | ❌ | ❌ | ❌ | ❌ |
| Manage OKR | ❌ | ❌ | ✅ | ❌ | ✅ |
| Manage employees / role mapping | ❌ | ❌ | ❌ | ❌ | ✅ (+ system admin) |

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
For every endpoint, generate cases: (allow) the named role, (deny) one role below it, (deny) cross-division same-level, (allow-read-only) OD, (allow) Director. Layered-role case: one fixture employee who is Staff+OD must get write access from Staff scope and read access from OD scope, never write from OD. Same shape applies to Viewer (Staff+Viewer writes from Staff scope only, reads everywhere from Viewer scope); anywhere a check is gated on the OD flag specifically (e.g. OKR management), Viewer must be denied — Viewer is not OD.
