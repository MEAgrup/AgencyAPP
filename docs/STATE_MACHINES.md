# CDPS — Consolidated State Machines (source config for the transition engine)

> Extracted verbatim from the PRD modules. Every transition not listed is **blocked server-side** with the BI message noted (default: `[transisi status tidak diizinkan]`). Every transition logs actor + timestamp, immutable.

## 1. Prospect attempt (M0/M1)
`Pending Validation` → `New Lead` → `Contacted` → { `Qualified` | `Not Qualified` } ; `Qualified` → Negotiation states → { `Closed-Success` | `Closed-Lost` }
- Intake collision ⇒ `Blocked` (no updates possible). Pool competitors on win ⇒ `[Closed - Kalah Kompetisi]` (auto).
- `Qualified` only via successful Qualified Form submit; exit without submit ⇒ stays `Contacted`.
- Negotiation states: `Negotiation - Pending Approval` → { `Negotiation - Approved` | `Negotiation - Revision Required` | `Negotiation - Rejected` }; Revision Required → (accept ⇒ Approved) | (resubmit ⇒ Pending Approval, new version); `Negotiation - Rejected` → (resubmit ⇒ Pending Approval, new version) | `Closed-Lost` (DECISIONS O16); No-nego path ⇒ `Negotiation - Auto Approved`. Closing only from Approved/Auto Approved.

## 2. Lead record (M1)
`[Pool]` (Marketing-imported, claimable) / active (scouted-owned) / `[Rejected]` / `[Not Qualified]` / `[Blocked - Duplikat]` (intake event).
- Duplicate of active external lead ⇒ reject row: `[lead sudah ada & sedang diproses, tidak diimport]` (attempt logged, not counted).
- Duplicate of Rejected/Not Qualified ⇒ reopen to `[Pool]`.
- Import gate: parent Campaign must be `[Active]`, else `[campaign belum/tidak aktif, lead tidak bisa diimport]`.

**`[Deleted]` — terminal (DEVIASI PRD, keputusan pemilik 2026-07-29, lihat `DECISIONS.md`).**
M1 tidak punya pintu hapus; ini ditambahkan atas permintaan pemilik. Tidak ada
`DELETE FROM leads` — "hapus" = transisi ke state terminal, jadi `audit_log` dan anak
`PRSP-`-nya tetap utuh (aturan rumah #3).

| From | To | Effect |
|---|---|---|
| active | `[Deleted]` | `require_lead` — ACC Head divisi asal lead (Director di mana saja) |
| `[Pool]` | `[Deleted]` | idem |
| `[Rejected]` | `[Deleted]` | idem |
| `[Not Qualified]` | `[Deleted]` | idem |

- Gate ada di **SQL**: keempat edge ber-`require_lead = true`, jadi `sm_transition` sendiri
  menolak staff dengan `[anda tidak memiliki akses untuk melakukan transisi ini]` —
  panggilan langsung via service-role tidak bisa memutari ACC.
- Dua pintu: sales **mengajukan** (`LDR-`, alasan wajib) → Head **ACC/tolak**. Satu antrian
  pending per lead, dijamin indeks `uq_ldr_one_pending`.
- **`[Closed-Success]` sengaja TIDAK diberi edge** ke `[Deleted]`: sudah klien, punya turunan
  uang (`CLI`/`TRX`/`INST`) ⇒ `[lead sudah menjadi klien, tidak bisa dihapus]`.
- **Tidak ada edge KELUAR** dari `[Deleted]`, termasuk untuk Director. Kalau hapus harus bisa
  dibatalkan, itu desain **restore** yang berbeda dan butuh keputusan tersendiri.
- Konsekuensi baca: `matchByPhone` **mengecualikan** baris terhapus (state terminal ⇒ intake
  tak punya langkah legal), `decideClaim` **memblokir** (`[lead sudah dihapus]`),
  `leadsDatabase` menyembunyikannya kecuali diminta `status='[Deleted]'` eksplisit.

## 3. Campaign `CMP-` (M3)
| From | To | Effect |
|---|---|---|
| Draft | Active | starts accepting leads |
| Active | Paused | stops accepting/attributing new leads |
| Paused | Active | resumes |
| Active/Paused | Closed | no new leads; late conversions attribute ≤ 3 months after Closed |
| Closed | Archived | read-only |
All else blocked: `[transisi status tidak diizinkan]`.

## 4. Transaction payment status (M5)
`[Menunggu Verifikasi]` → `[Terverifikasi - Sebagian]` → (further verifications) → `[Lunas]` (terminal)
- Lunas scheme: may jump `[Menunggu Verifikasi]` → `[Lunas]` in one verification.
- `[Jatuh Tempo]` = parallel flag per overdue installment (not a status); clears on verification.
- `[Bermasalah]` = dispute/reversal flag; resolution needs joint SPV Finance + SPV Account approval (M5-OA-5).
- **Routing gate:** Client releases to Account on first transition into `[Terverifikasi - Sebagian]` or `[Lunas]`. Before that, record visible to Finance only.

## 5. Installment `INST-` (M5)
`[Belum Jatuh Tempo]` → `[Jatuh Tempo]` (due date passed unverified) → `[Terverifikasi]`; or `[Belum Jatuh Tempo]` → `[Terverifikasi]` directly. Transaction = `[Lunas]` only when ALL installments `[Terverifikasi]`.

## 6. Service (M6)
`[Awaiting Onboarding]` → `[Strategy Approved]` (plan-gated only; Direct services skip) → `[Briefed]` (first Brief created) → `[In Execution]` (any Brief leaves `[To Do]`) → done state per Brief rollup. Void Service (M4-OA-5): SPV/Account Lead approval; cascades child Briefs not yet `[Approved]` → `[Cancelled — Service Voided]`.
- **Per-Service flag `Requires Strategy Plan`** (§2): inherited read-only from the Service Catalog (MSL) at closing and pinned on the Service row. `Yes` ⇒ Plan-gated, `No` ⇒ Direct.
- **Direct-breakdown guard (data-dependent, enforced in `module6_account`, NOT the config engine):** the edge `[Awaiting Onboarding]` → `[Briefed]` is the **Direct path only**. A Plan-gated Service (flag = `Yes`) may reach `[Briefed]` **only after** `[Strategy Approved]`; taking the direct edge while still `[Awaiting Onboarding]` is rejected with `[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]`. The config engine cannot see the per-row flag, so this gate is a code guard the Brief-creation cluster must call before driving that edge.

## 6a. Strategy & Plan `STR-` (M6 §4) — plan-gated services only
`[Strategy Drafting]` → `[Strategy Submitted for Approval]` → `[Strategy Approved]` (terminal)
| From | To | Who | Effect |
|---|---|---|---|
| `[Strategy Drafting]` | `[Strategy Submitted for Approval]` | owning AM (owner action, not lead) | AM submits the Plan for approval |
| `[Strategy Submitted for Approval]` | `[Strategy Approved]` | SPV/Head Account only (requireLead) | On approval the parent Service also transitions `[Awaiting Onboarding]` → `[Strategy Approved]` (§6) in the same transaction; `Approved By` recorded |
| `[Strategy Submitted for Approval]` | `[Strategy Drafting]` | SPV/Head Account only (requireLead) | Revision requested; `Revision Notes` mandatory; Revision Count +1 (derived from the audit log, never a stored tally) |
- One Strategy per Service (1:1, §4 Rule 1). Direct-path Services have **no** STR record (§4 Rule 6).
- Only `[Strategy Approved]` unlocks Brief creation for that Service (§4 Rule 5).
- The approval gate is division-specific (Account lead / Director), stricter than the engine's division-agnostic `requireLead`; the code checks it before the transition (mirrors the Void-Service gate).

## 7. Brief `BRF-` (M6) — also the canonical Task machine (M12) applied to AST / BKG / BRF-as-task
`[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]` (terminal)
- `[In Review]` → `[Revision Requested]` → `[In Progress]` (loop; Revision Count +1; turnaround does NOT reset).
- `[Blocked]`: pause, resume to `[In Progress]`; **SPV/Lead-only transition**; staff/AM submit block requests (pending queue). Blocked intervals excluded from turnaround.
- `[Cancelled — Service Voided]`: terminal, only via Void cascade.
- Live Stream Briefs skip this machine entirely (M10).
- Ads: Brief-as-task uses this machine (M12 §5.3b); post-Approved optimization lives on ADC, not the Brief.

## 8. Creator Booking `BKG-` (M9)
`[Sourcing]` → `[Booked]` → `[Content In Progress]` → `[Content Submitted]` (content link mandatory) → `[QC Review]` → { `[QC Passed]` (terminal) | `[QC Failed - Revision Requested]` (→ creator fixes → `[Content Submitted]`, counter +1, cap per M9) | `[Escalated - Creator Unresponsive]` (AM/Lead decide; SPV/Head Account final call on disagreement) | `[Dropped]` (terminal; excluded from Speed Score entirely) }.
- M12 mapping: Sourcing/Booked/Content In Progress ⇒ In Progress bucket; Content Submitted/QC Review ⇒ Submitted/In Review; QC Passed ⇒ Approved; Escalated ⇒ Blocked-equivalent; Dropped ⇒ excluded.

## 9. Creator Payment Request `CPR-` (M9)
`[Requested]` → `[Received by Finance]` → { `[Paid]` | `[Rejected]` (reason mandatory, back to KOL) }.

## 10. Live Stream Session `LSS-` (M10)
`[Requested]` → `[Confirmed by Vendor]` → `[Completed]` (result fields + Vendor Report Link mandatory) → { `[Reconciled]` (terminal) | `[Discrepancy Flagged]` (notes mandatory; SPV notified real-time; non-blocking → may later move to `[Reconciled]`) }.
- Brief closes to `[Approved]` when its Sessions reach `[Reconciled]`.
- **Reopen (O27 resolved 2026-07-14, choice b):** an `[Approved]` Live Stream Brief may be **reopened** back to `[Dispatched to Vendor]` to add Sessions for the running recurring period (M10-OA-4 weekly cadence). Like the close, this is an **off-machine audited action** (`ls_brief_reopened` — the LS Brief never joined the §7 machine), allowed only from `[Approved]`, only for a Live-Stream-division Brief, never for a voided Brief; actor gate = owning AM or Director (same §6.1 write gate as Sessions). After reopen, the existing roll-up re-closes the Brief once ALL Sessions (old + new) are `[Reconciled]`.

## 11. Complaint `CPL-` (M6)
`[Open]` → `[In Progress]` → `[Resolved]` → `[Closed]` (AM confirms client satisfaction — distinct from Resolved). Source ∈ {Sales, WhatsApp (AM-logged), Client Portal}.

## 12. Dependency `DEP-` (M11)
Status auto-computed, no manual transitions: `Pending` (source not started) → `Blocking` (source unfinished & type=Blocking) → `Satisfied` (source reached terminal). Create-time validations (server-side): same Client only; no duplicate active pair; no cycles (graph traversal). Blocking gate rejects the Target's final transition with e.g. `"Brief ini belum bisa lanjut ke [In Execution] karena menunggu BRF-… selesai Approved."` Built-in implicit dependency: linked Creative Asset must be `[Approved]` before Ad Campaign Launch (M8) — hardcoded, never user-declared.

## 13. No-status entities
`CHR-` and `PERF-` snapshots: created immutable by monthly batch, never transition. Notification records: unread → read only.

## 14. Ad Campaign `ADC-` (M8) — the ongoing paid-media record, separate from the setup Brief
The Ad Campaign is a **living** record that **outlives** its setup Brief (M8 §2): the Brief (a Brief-as-task on the §7 machine) closes once setup is approved, but the `ADC-` keeps running and accumulating metrics/optimizations underneath it. Lifecycle (M8 §2 / §9.3 — exactly three statuses, no others):
`[Paused]` (born held — created while the parent Brief is `[In Progress]`, **not launched with real spend** yet, §4 Rule 4) `↔` `[Active]` → `[Ended]` (terminal).

| From | To | Who | Effect |
|---|---|---|---|
| `[Paused]` | `[Active]` | Advertiser (Ads staff/lead) / Director | **Launch / Resume.** Real spend begins (§4 Flow 2). Gated in code (not the engine): the parent Brief must be `[Approved]` **and** every currently-linked Creative Asset must be `[Approved]` (the built-in implicit dependency, §12 — hardcoded, never user-declared). |
| `[Active]` | `[Paused]` | Advertiser / Director | **Pause** — optimization/held (e.g. while the setup Brief is in `[Revision Requested]`). No approval gate (routine optimization, §6 Rule 3). |
| `[Active]` | `[Ended]` | Advertiser / Director | End date reached, budget exhausted, or manually stopped (§2). Terminal. |
| `[Paused]` | `[Ended]` | Advertiser / Director | A held campaign may be ended without ever launching. Terminal. |

- Born `[Paused]` (engine `initial`), **not** via the engine — creation is a birth-status INSERT (same precedent as Brief/Asset/Strategy birth statuses); every later move goes through the engine (house rule 2).
- The `[Paused]↔[Active]` edges are **not** `requireLead` at the engine level — the Advertiser optimizes freely (§6 Rule 3). The Launch dependency (Brief + Assets `[Approved]`) is a **code guard** on the `[Paused]→[Active]` edge (mirrors the Void-Service / Direct-breakdown code guards), because the engine cannot see the parent Brief's or linked Assets' statuses.
- Metric Entries (`MTR-`) and Optimization Log entries (`OPT-`) are **append-only child rows** (M8 §5/§6), not state machines: they carry no status and never transition. Total Spend / Total GMV / ROAS and each Asset's Attributed GMV are **derived** from these immutable rows (house rules 3/4), never stored as mutable running columns.
- **Recurring strategy cycles (M8-OA-6):** a new setup `BRF-` is created each cycle, but the **same `ADC-` continues uninterrupted** — the campaign is never restarted; only the Brief above it is new.
