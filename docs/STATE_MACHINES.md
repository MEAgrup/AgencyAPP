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

## 11. Complaint `CPL-` (M6)
`[Open]` → `[In Progress]` → `[Resolved]` → `[Closed]` (AM confirms client satisfaction — distinct from Resolved). Source ∈ {Sales, WhatsApp (AM-logged), Client Portal}.

## 12. Dependency `DEP-` (M11)
Status auto-computed, no manual transitions: `Pending` (source not started) → `Blocking` (source unfinished & type=Blocking) → `Satisfied` (source reached terminal). Create-time validations (server-side): same Client only; no duplicate active pair; no cycles (graph traversal). Blocking gate rejects the Target's final transition with e.g. `"Brief ini belum bisa lanjut ke [In Execution] karena menunggu BRF-… selesai Approved."` Built-in implicit dependency: linked Creative Asset must be `[Approved]` before Ad Campaign Launch (M8) — hardcoded, never user-declared.

## 13. No-status entities
`CHR-` and `PERF-` snapshots: created immutable by monthly batch, never transition. Notification records: unread → read only.
