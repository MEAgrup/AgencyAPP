# CDPS — Module 6B: Kolom **Plan** (Full Store Management)

> **Scope.** Field-level specification of the **Plan** form: the execution breakdown an Account Manager fills per period, derived from an approved Strategi (Module 6A). Plan is the layer where "arah" becomes "kerjaan minggu ini", and the layer Briefs are created from.
>
> **Body text: English. Field labels, statuses, UI copy: Bahasa Indonesia.**

## Contents
1. Background
2. Locked decisions
3. The structural risk in D2+D4 — and the guardrail
4. Rules
5. Form structure — Section P-A → P-H
6. Flow
7. Example — Alpha Digital, periode 1 & 2
8. System Requirements
9. Open Assumptions
10. Success Metrics

---

## 1. Background

**Problem.** Strategi answers "what are we doing and why" for the whole contract. It does not answer "what lands on Creative's desk in week 2 of month 3". Today that translation happens in a spreadsheet or in the AM's head, which produces three failures: divisions receive Briefs with no visible relationship to the strategy; nobody can say mid-contract whether the plan was actually executed or quietly abandoned; and when GMV misses, the post-mortem cannot separate *bad strategy* from *unexecuted strategy* — the single most useful distinction there is.

**Why now.** Module 6A closes the strategy gate. Without Plan, the gate opens onto nothing — Briefs would still be created ad hoc, and the Strategi becomes a document written once and never consulted.

**Expected outcome.** One Plan record per period, generated from the Strategi and completed by the AM, that (i) lists every planned work item with a division owner and a week, (ii) records actuals against plan so variance is visible without a separate report, and (iii) becomes the source AM works from when creating Briefs.

---

## 2. Locked decisions

| # | Decision | Value |
|---|---|---|
| P1 | Granularity | **Monthly mandatory**, weekly rows **auto-generated** from monthly |
| P2 | Approval | **Period 1 only.** Periods 2…n activate automatically |
| P3 | Plan row → Brief | AM creates Briefs **manually** from Plan rows (no auto-Brief) |
| P4 | Period targets | Auto-pulled from Strategi D-2, **AM may adjust with a written reason** |
| P5 | Actuals | **Hybrid** — GMV entered manually by AM; other metrics auto from execution modules |
| P6 | Who fills it | **AM alone.** Divisions do not fill Plan rows |
| P7 | Period boundaries | Anniversary-month cycle from `tanggal_mulai_siklus` (Module 6A, G-0 / Rule 17) |

Inherited from Module 6A: resource commitment is soft (20% tolerance), floor price is a guardrail, Live Stream is vendor-mode, Strategi is client-visible via read-only link.

---

## 3. The structural risk in P2 + P4 — and the guardrail

Read P2 and P4 together and there is a hole: periods 2…n activate with no approval, **and** the AM can adjust the period target. Nothing in those two rules alone stops an AM from lowering the month-5 target to match what is already achievable, with a one-line reason nobody reads. The contract floor would still be met on paper at the Strategi level while every period quietly re-baselines downward — and the variance metric that is supposed to catch drift becomes the thing being edited.

This is not a hypothetical failure mode; it is the default behaviour of any system that lets the measured party edit the measure.

**Guardrail (Rule 9).** Target adjustment is asymmetric:

| Adjustment | Treatment |
|---|---|
| **Upward** (AM raising the period target) | Free. Reason optional. Activates immediately |
| **Downward ≤ 10%** of the Strategi figure | Allowed with mandatory reason. Notifies SPV. Activates immediately |
| **Downward > 10%** | Requires SPV approval before the period activates — the only case where a period 2…n needs a human gate |
| **Any downward adjustment** | The shortfall is **not deleted** — it is written to `defisit_terbawa` and displayed on every subsequent period and on the contract-level view |

So P2 holds — periods run automatically — except on the one action where automation would be self-serving. And because the deficit is carried rather than absorbed, lowering a month's target never lowers the contract's cumulative expectation. It just makes the gap visible earlier, which is the point.

---

## 4. Rules

0. **This module describes the Full-Management Plan** (contract-scoped, Strategi-parented). For à la carte services, the Plan-gate determination and the Strategi-less **Plan Satuan** variant are specified in Module 6C — read §7 there for the field-level diff before implementing.
1. Plan records are generated **only** on Strategi approval: `n` periods, `n` = contract months, boundaries per P7. No manual Plan creation.
2. Period 1 starts as `Draft`. Periods 2…n start as `Terjadwal` (scheduled, not yet editable-as-active).
3. **Period 1 requires SPV approval** (`Diajukan` → `Disetujui`). Its approval is what activates the Plan mechanism for the whole contract.
4. Periods 2…n move `Terjadwal` → `Aktif` automatically at 00:00 WIB on their start date — **except** when a `Turun >10%` adjustment is pending (Rule 9), which holds the period in `Menunggu Persetujuan` until resolved. If unresolved by the start date, the period activates with the **original Strategi target** and the adjustment request is marked `Kedaluwarsa`. Execution is never blocked by an unanswered approval.
5. Only one period is `Aktif` at a time. The previous period must be `Ditutup` before the next activates; if the AM has not closed it, the system force-closes with `Ditutup Otomatis` and flags incomplete actuals.
6. **Plan rows are the unit of work.** Each row = one channel × one pillar × one action, with a division owner, a week, a quota, and a target. Every row must reference the Strategi pillar it descends from (`strategi_pillar_id`). A row with no strategy parent is possible but is flagged `Di Luar Strategi` and counted in the deviation metric.
7. **Weekly rows are derived, not typed (P1).** On period activation the system splits each monthly Plan row across the period's weeks. Default distribution: even split, then re-weighted toward weeks containing a big date from Strategi G-2. The AM can re-drag the distribution; the weekly total must always equal the monthly quota (DB check). The AM cannot add a weekly row that has no monthly parent.
8. **Targets are pre-filled from Strategi D-2** per channel per metric, editable per Rule 9. Original and adjusted values are both stored — the original is never overwritten.
9. Target adjustment follows the asymmetric table in §3. `defisit_terbawa` is computed, not typed, and is immutable.
10. **Actuals are hybrid (P5).** GMV per channel is entered manually by the AM with a source attachment and capture date. All other metrics (ad spend, ROAS, video count, creator count, live hours, Brief completion) are pulled from the execution modules at period close and are read-only. An AM cannot overwrite an auto metric; they can file a `Sengketa Angka` note against it, which routes to SPV.
11. **GMV entry has an integrity window.** Manual GMV must be entered within 5 days of period close, is locked once the period is `Ditutup`, and any post-close correction creates an audit-logged amendment visible on the period view. Rationale: the one manually-entered number is the one every other calculation depends on.
12. **Briefs are created manually from rows (P3).** A row shows `Brief: belum dibuat / n dibuat / selesai`. Rows still at `belum dibuat` when 50% of the period has elapsed raise a `Baris Belum Dieksekusi` warning on the SPV dashboard. The system never auto-creates a Brief — but it never lets an unexecuted row stay quiet either.
13. Briefs inherit from the row without re-typing: hero SKU, floor price, campaign type and ACOS target, content pillar, quota, and the `Internal Saja` visibility of any strategy note attached.
14. **Soft commitment carries down (Module 6A F).** Sum of row budgets/quotas per period is compared to the Strategi resource commitment. Over by ≤20% → `Lewat Komitmen` warning + reason. Over by >20% → SPV notification, still not blocked.
15. **Period close is a real step, not a date.** Closing requires: manual GMV entered per channel, every row set to a terminal state (`Selesai` / `Sebagian` / `Tidak Dikerjakan` with a reason), and the period review (P-F) completed. Force-close on overrun sets missing rows to `Tidak Dikerjakan — tanpa keterangan`, which is deliberately ugly in reports.
16. **Carry-over is explicit.** Rows marked `Sebagian` or `Tidak Dikerjakan` prompt: carry to next period, drop, or escalate to a Strategi revision. Choice is recorded; carried rows appear in the next period tagged `Terbawa` with their origin period.
17. **Plan cannot contradict an inactive Strategi.** If the Strategi enters `Draft Revisi`, the current period continues on the last approved version. On approval of the new version, remaining `Terjadwal` periods are regenerated (unstarted periods only — active and closed periods are never rewritten).
18. **AM-only authorship (P6).** Divisions have read access to rows they own and can comment, but cannot edit quota, target, or week. A division that believes a quota is undeliverable files `Keberatan Kapasitas` → notifies AM + SPV. This is deliberate: the AM stays accountable for the plan, and capacity disputes become visible records rather than WhatsApp arguments.
19. Immutable audit log on every field change, adjustment, approval, close, and carry-over decision (actor + WIB timestamp + before/after).

---

## 5. Form structure

Legend: **W** = wajib · **O** = opsional · **A** = auto/read-only · ↻ = per active channel

### SECTION P-A — Header & Konteks Periode
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| PA-1 | ID Plan & Periode | `PLAN-…`, nomor periode (1..n), tanggal mulai–akhir, jumlah minggu | Auto | A |
| PA-2 | Strategi Induk | `STRG-…` + versi yang berlaku untuk periode ini | Auto | A |
| PA-3 | Fase Strategi | Fase dari Strategi G-1 yang mencakup periode ini + kriteria lulus fase | Auto | A |
| PA-4 | Tanggal Besar | Tanggal besar dari Strategi G-2 yang jatuh di periode ini | Auto | A |
| PA-5 | Status Periode | `Terjadwal` / `Draft` / `Diajukan` / `Menunggu Persetujuan` / `Aktif` / `Ditutup` / `Ditutup Otomatis` | Auto | A |
| PA-6 | Defisit Terbawa | Akumulasi kekurangan dari periode sebelumnya (Rp) — tak bisa diedit | Auto | A |
| PA-7 | Catatan Pembuka | Konteks periode ini menurut AM (mis. "fokus perbaikan listing, iklan ditahan") | Long text | W |
| PA-8 | Asumsi Strategi yang Dipantau | Asumsi D-8 yang relevan periode ini + statusnya | Auto + status toggle | W |

### SECTION P-B — Target Periode ↻ per channel
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| PB-1 | Target dari Strategi | Target GMV & metrik pendukung dari D-2/D-4 untuk bulan ini | Auto | A |
| PB-2 | Target Dipakai | Angka yang AM pakai untuk periode ini | Currency/number | W |
| PB-3 | Arah & Besaran Penyesuaian | Auto: `Tidak Berubah` / `Naik x%` / `Turun x%` | Auto | A |
| PB-4 | Alasan Penyesuaian | Wajib untuk penurunan; opsional untuk kenaikan | Long text | W (kondisional) |
| PB-5 | Bukti Pendukung | Lampiran untuk penurunan >10% (data, screenshot, email klien) | File | W (kondisional) |
| PB-6 | Dampak ke Defisit | Auto: kekurangan yang masuk `defisit_terbawa` | Auto | A |
| PB-7 | Target Metrik Pendukung | Pengunjung, CR, AOV, ROAS min/ACOS maks, jumlah video, kreator aktif, jam live vendor | Struct | W |

### SECTION P-C — Baris Rencana Kerja (inti Plan)
One row per planned work item. This is the table Briefs are created from.

| ID | Field per baris | Type | Req |
|---|---|---|---|
| PC-1 | Channel | Enum (channel aktif kontrak) | W |
| PC-2 | Pilar | Enum: SKU/listing · harga & promo · iklan · konten · affiliate/KOL · live (vendor) · retensi/CRM · operasional | W |
| PC-3 | Turunan dari Strategi | Referensi `strategi_pillar_id` — atau tandai `Di Luar Strategi` + alasan | Reference / flag + text | W |
| PC-4 | Aksi | Deskripsi kerja konkret ("rewrite listing 7 SKU Pareto", bukan "optimasi listing") | Text | W |
| PC-5 | SKU Sasaran | SKU yang kena aksi ini (dari hero/pendamping di Strategi E-3) | Multi-reference | O |
| PC-6 | Kuota / Volume | Angka + unit (mis. 40 video, 7 listing, 36 jam live) | Number + unit | W |
| PC-7 | Budget | Rp yang dialokasikan ke baris ini (untuk baris iklan/seeding/vendor) | Currency | W (kondisional) |
| PC-8 | Divisi PIC | Creative / Ads / KOL / Live-vendor / Account / Ops | Enum | W |
| PC-9 | Minggu Sasaran | Minggu ke-berapa dalam periode (bisa lintas minggu) | Multi-select minggu | W |
| PC-10 | Prioritas | `Wajib` / `Penting` / `Kalau Sempat` — dipakai saat kapasitas mepet | Enum | W |
| PC-11 | Hasil yang Diharapkan | Metrik & angka yang baris ini seharusnya gerakkan | Text + number | W |
| PC-12 | Prasyarat | Yang harus ada dulu (aset dari klien, akses, approval, stok) | Text | O |
| PC-13 | Status Brief | `Belum dibuat` / `n dibuat` / `Selesai` | Auto | A |
| PC-14 | Status Baris | `Rencana` / `Jalan` / `Selesai` / `Sebagian` / `Tidak Dikerjakan` | Enum | W (saat tutup) |
| PC-15 | Catatan Divisi | Komentar divisi PIC (read-only untuk AM, tak bisa dihapus) | Thread | A |
| PC-16 | Keberatan Kapasitas | Flag dari divisi + alasan (Rule 18) | Flag + text | A |
| PC-17 | Visibilitas | `Bagikan ke Klien` / `Internal Saja` — default shareable kecuali baris ops/internal | Enum | W |

### SECTION P-D — Distribusi Mingguan (auto, bisa digeser)
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| PD-1 | Matriks Minggu × Baris | Kuota per baris per minggu; total per baris wajib = PC-6 | Auto + editable matrix | A/W |
| PD-2 | Dasar Pembagian | `Rata` / `Diberatkan ke tanggal besar` / `Manual AM` | Enum | A |
| PD-3 | Beban per Divisi per Minggu | Total kuota per divisi per minggu + tanda kalau melebihi kapasitas Strategi F-5 | Auto | A |
| PD-4 | Minggu Terakhir | Sisa hari periode (bisa 8–10 hari) — ditandai, bukan dibikin minggu stub | Auto | A |

### SECTION P-E — Realisasi & Variance (hybrid, P5)
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| PE-1 | GMV Aktual ↻ per channel | **Diinput manual AM** | Currency | W |
| PE-2 | Sumber & Tanggal Ambil Data | Lampiran export/screenshot + tanggal | File + date | W |
| PE-3 | Metrik Otomatis | Ad spend, ROAS/ACOS, jumlah video selesai, kreator aktif, jam live vendor, Brief selesai/total | Auto dari modul eksekusi | A |
| PE-4 | Variance | Auto: aktual vs PB-2 (Rp & %) per channel & total | Auto | A |
| PE-5 | Variance vs Target Asli | Auto: aktual vs PB-1 (target Strategi, sebelum penyesuaian) | Auto | A |
| PE-6 | Sengketa Angka | Bantahan AM atas metrik otomatis + alasan → notifikasi SPV | Text | O |
| PE-7 | Kontribusi per Channel | Auto: % aktual vs target komposisi Strategi D-3 | Auto | A |
| PE-8 | Eksekusi vs Rencana | Auto: % baris `Selesai`, % kuota tercapai, % budget terpakai | Auto | A |

**Design note.** PE-4 and PE-5 are both shown, side by side, deliberately. PE-4 answers "did we hit what we said this month"; PE-5 answers "did we hit what we promised at kickoff". An AM who has adjusted targets downward sees both numbers every period, and so does the SPV.

### SECTION P-F — Review Penutup Periode
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| PF-1 | Yang Jalan | Apa yang bekerja + bukti angka | Long text | W |
| PF-2 | Yang Tidak Jalan | Apa yang gagal + kenapa (akar, bukan gejala) | Long text | W |
| PF-3 | Diagnosa Gap | Kalau miss target: sebabnya **strategi salah** atau **eksekusi tidak jalan**? + bukti dari PE-8 | Enum + text | W (kalau variance negatif) |
| PF-4 | Status Asumsi | Update asumsi D-8: `Berlaku` / `Gugur` / `Terverifikasi` | Struct | W |
| PF-5 | Keputusan Carry-over | Per baris `Sebagian`/`Tidak Dikerjakan`: dibawa / dibatalkan / naik jadi revisi Strategi | Struct per baris | W |
| PF-6 | Rekomendasi Periode Depan | Yang harus diubah di periode berikutnya | Long text | W |
| PF-7 | Perlu Revisi Strategi? | Ya/Tidak + trigger H-2 yang terpicu | Enum + reference | W |
| PF-8 | Materi untuk Klien | Poin yang akan disampaikan ke klien di review bulanan | Long text | W |

### SECTION P-G — Deviasi & Peringatan (auto, read-only)
| ID | Content |
|---|---|
| PG-1 | Baris `Di Luar Strategi` — jumlah + daftar |
| PG-2 | Baris `Lewat Komitmen` (>20% dari Strategi F) + alasan |
| PG-3 | Baris `Di Bawah Floor` (harga di bawah floor price E-4) + status ack SPV |
| PG-4 | Baris `Belum Dieksekusi` di tengah periode |
| PG-5 | `Keberatan Kapasitas` dari divisi yang belum diselesaikan |
| PG-6 | Penyesuaian target turun di periode ini + akumulasi defisit |

### SECTION P-H — Persetujuan & Jejak
| ID | Content | Req |
|---|---|---|
| PH-1 | **Periode 1:** AM submit → SPV `Disetujui`/`Dikembalikan` + catatan | W (periode 1) |
| PH-2 | **Periode 2…n:** aktivasi otomatis — dicatat siapa/kapan (sistem) | A |
| PH-3 | Persetujuan penyesuaian target turun >10% (SPV) | W (kondisional) |
| PH-4 | Penutupan periode: oleh AM atau `Ditutup Otomatis` oleh sistem | A |
| PH-5 | Riwayat perubahan lengkap | A |

---

## 6. Flow

1. Strategi `Disetujui` → system generates `n` Plan periods. Period 1 = `Draft`, periods 2…n = `Terjadwal`, each pre-filled with targets from D-2 and a skeleton of rows from E + F (channel × pillar × quota).
2. AM completes period 1: adjusts rows, sets weeks, priorities, prerequisites. Submits → SPV approves. Period 1 → `Aktif`.
3. Weekly rows auto-generate on activation (even split, re-weighted to big dates). AM may re-drag; weekly total must equal monthly.
4. AM creates Briefs manually from rows. Each Brief inherits SKU, floor price, ACOS target, pillar, quota. *Error paths:* over-commitment → warning + reason; below floor price → SPV ack; row still `Belum dibuat` at period midpoint → SPV dashboard warning.
5. Divisions execute. They can comment on rows and file `Keberatan Kapasitas`; they cannot edit quota/target/week.
6. Period ends. AM enters manual GMV (within 5 days) + source; auto metrics pull from execution modules; variance computes against both adjusted and original targets.
7. AM completes P-F review, decides carry-over per unfinished row, updates assumption statuses. Period → `Ditutup`. *Error path:* not closed within the window → `Ditutup Otomatis`, missing rows marked `Tidak Dikerjakan — tanpa keterangan`.
8. Next period auto-activates at 00:00 WIB on its start date, carrying over: `Terbawa` rows, `defisit_terbawa`, and any target adjustment already filed. If a `Turun >10%` request is pending, the period holds in `Menunggu Persetujuan`; unresolved by start date → activates on the original Strategi target.
9. If PF-7 says a Strategi revision is needed → Module 6A revision flow. Approved new version regenerates only the `Terjadwal` periods.
10. Contract end → all periods `Ditutup`, Strategi `Kedaluwarsa`. Contract-level rollup: cumulative actual vs original Strategi target vs adjusted targets, plus total deficit carried.

---

## 7. Example — Alpha Digital

**Contract:** Full Store Management, Shopee + TikTok Shop + Tokopedia, 6 months, floor Rp 400jt/month by M6, stretch Rp 460jt. Cycle start 12 Aug 2026 → period 1 = 12 Aug–11 Sep.

**Period 1 (Draft → Approved).**
Targets from Strategi: Shopee Rp 195jt, TikTok Shop Rp 20jt, Tokopedia Rp 0 (not yet open). AM keeps them unchanged (PB-3 = `Tidak Berubah`).

Rows (excerpt):

| Channel | Pilar | Aksi | Kuota | Budget | PIC | Minggu | Prioritas |
|---|---|---|---|---|---|---|---|
| Shopee | SKU/listing | Rewrite listing 7 SKU Pareto (foto existing, tanpa reshoot) | 7 listing | — | Creative | W1–W2 | Wajib |
| Shopee | Iklan | Matikan 3 kampanye nol-order, restruktur ke ACOS ≤18% | 3 + 1 restruktur | Rp 45jt | Ads | W1 | Wajib |
| Shopee | Affiliate | Naikkan komisi hero SKU ke 12%, rekrut kreator | 30 kreator | Rp 5jt sampel | KOL | W2–W4 | Wajib |
| TikTok Shop | Konten | Video hero SKU, angle "rak muat 3x" | 15 video | — | Creative | W2–W4 | Penting |
| TikTok Shop | Iklan | Kampanye uji, budget kecil | 2 kampanye | Rp 10jt | Ads | W3–W4 | Kalau Sempat |

Weekly split: the Shopee listing row (7 listings) auto-splits 4/3 across W1–W2. The affiliate row weights toward W3 because 9.9 falls there (from Strategi G-2). Prerequisite on the TikTok content row: Affiliate Center access (Strategi A-16 blocker) — flagged, target cleared W1.

**Period 1 close.** Manual GMV: Shopee Rp 188jt, TikTok Shop Rp 12jt. Auto metrics: ad spend Rp 43jt, ROAS 4,6 (up from 4,1), 11 of 15 videos done, 19 of 30 creators recruited, 6 of 7 listings rewritten. PE-4 variance −Rp 15jt (−7%). PE-8: 71% of rows `Selesai`.

PF-3 diagnosis: **execution, not strategy** — ROAS moved in the right direction and the rewritten listings converted, but the creator recruitment row underdelivered because Affiliate Center access landed in W3 instead of W1. PF-4: the "access within 5 days" assumption → `Gugur`. PF-5: creator row carried to period 2 as `Terbawa`. PF-7: no Strategi revision — the thesis held; the prerequisite slipped.

**Period 2 (auto-activated 12 Sep).** Carries the `Terbawa` creator row (11 remaining creators) on top of period 2's own 40. The AM judges 51 creators in one month unrealistic and requests Shopee target Rp 210jt → Rp 200jt (−4,8%). That is a downward adjustment ≤10%: allowed with reason, SPV notified, period activates immediately, and Rp 10jt is written to `defisit_terbawa`. It shows on every remaining period and on the contract view — so the month-6 rollup will compare against Rp 460jt regardless.

Had the AM asked for −Rp 40jt (−19%), the period would have held at `Menunggu Persetujuan` for SPV. Unanswered by 12 Sep → the period activates on the original Rp 210jt.

---

## 8. System Requirements

**Entities.** `PLAN-YYYY-NNNNN` (period). Children: `PLAN_TARGET` (per channel per metric, holding both original and adjusted), `PLAN_ROW` (P-C), `PLAN_ROW_WEEK` (P-D), `PLAN_ACTUAL` (P-E), `PLAN_REVIEW` (P-F), `PLAN_FLAG` (P-G). Register `PLAN` in `entity_prefix` alongside `STRG` and `VND` (Module 6A §7).

**Relations.** `STRG` 1:N `PLAN`; `PLAN` 1:N `PLAN_ROW`; `PLAN_ROW` 1:N `PLAN_ROW_WEEK`; `PLAN_ROW` 1:N `BRIEF`. Every Brief carries `plan_row_id`, `plan_id`, `strategi_id`, `strategi_version` — a four-level trace from an executed Brief back to the strategy version that authorised it.

**State machine (machine #16).** `Terjadwal` → `Draft` (period 1 only) → `Diajukan` → (`Disetujui` → `Aktif` | `Dikembalikan` → `Draft`); `Terjadwal` → `Aktif` (auto, periods 2…n); `Terjadwal` → `Menunggu Persetujuan` → `Aktif`; `Aktif` → `Ditutup` | `Ditutup Otomatis`. Transitions only via `sm_transition`.

**Scheduled jobs.** (a) 00:00 WIB daily — activate periods whose start date is today, force-close overdue periods; (b) period midpoint — emit `Baris Belum Dieksekusi` warnings; (c) period close + 5 days — emit `plan_realisasi_belum_lengkap` if manual GMV is missing. All jobs idempotent, all timestamps `WIB_OFFSET_HOURS=7`.

**Notification catalog — single amendment covering 6A + 6B + 6C.** Base 15 + 4 Strategi + 6 Plan + 3 Gate = **28 events, catalog v2**. One migration, not three. Plan events:

| Event | Fires when | Recipients |
|---|---|---|
| `plan_periode_aktif` | Period activates (manual or auto) | AM, division leads with rows |
| `plan_target_diturunkan` | Any downward target adjustment | SPV (≤10%: notify; >10%: approval request) |
| `plan_baris_belum_dieksekusi` | Rows with no Brief at period midpoint | AM + SPV |
| `plan_keberatan_kapasitas` | Division files a capacity objection | AM + SPV |
| `plan_realisasi_belum_lengkap` | Manual GMV missing 5 days after close | AM + SPV |
| `plan_periode_ditutup` | Period closed (incl. auto-close, with flag) | AM, SPV, Finance |

**Field-level notes.**
- `PLAN_TARGET`: `(plan_id, channel, metric)` PK, columns `nilai_strategi` (immutable), `nilai_dipakai`, `arah`, `persen_perubahan`, `alasan`, `bukti_file`, `status_persetujuan`. DB check: `alasan NOT NULL` when `arah = 'turun'`.
- `defisit_terbawa`: computed column at contract level = Σ(`nilai_strategi` − `nilai_dipakai`) for downward adjustments, plus Σ negative variance where chosen to carry. Never writable. Exposed on every period view and the contract rollup.
- `PLAN_ROW_WEEK`: DB trigger asserting Σ weekly quota = `PLAN_ROW.kuota`. Reject with the row ID and the delta, not a generic error.
- `PLAN_ACTUAL`: `sumber` ∈ `manual` / `otomatis` per metric; `manual` rows require `file_bukti` + `tanggal_ambil`; `otomatis` rows are `UPDATE`-blocked at the DB level for AM roles (belt and braces with RLS — TS predicate and RLS must not diverge, frozen invariant).
- Period close is a transaction: all row terminal states + all manual GMV + review complete, or nothing. Partial close is not a state.
- Money: IDR integer minor units, byte-exact BI formatting (frozen invariant).
- Client view: the Plan is reachable from the same read-only Strategi link (Module 6A) as a period tab, shareable rows only (PC-17), current active + closed periods, never `Terjadwal` ones — a client should not see a plan for a month that has not started and may still change.

**Permissions.**
| Role | Read | Write |
|---|---|---|
| AM (assigned) | own clients, all periods | P-A…P-F on `Draft`/`Aktif`; manual GMV only |
| SPV / Head of Account | all | P-H approvals, target-adjustment approvals, override |
| Division lead | rows owned by their division + P-B targets | comments + `Keberatan Kapasitas` only |
| Finance | budgets (PC-7) + closed-period actuals | none |
| Direksi | all | none |

**Non-functional.** Row table must stay usable at ~80 rows/period (drag-and-drop weekly matrix, virtualised). Autosave every 20s. Desktop-first for editing; mobile read-only view of the current period, plus mobile-capable `Keberatan Kapasitas` for division leads (they are rarely at a desk).

---

## 9. Open Assumptions

| ID | Assumption | Owner |
|---|---|---|
| PA-1 | Downward-adjustment threshold set at **10%** — the number that decides how often SPV gets pulled in. Cheap to tune, worth a deliberate choice | Yohan / Yulianti |
| PA-2 | Manual GMV window = **5 days** after period close before a warning fires | Yulianti |
| PA-3 | Assumed the execution modules already expose the auto metrics in PE-3 (ad spend, ROAS, video count, creator count, vendor live hours, Brief completion). Any metric not yet available must fall back to manual — and the list of manual metrics must then be explicit, not silently mixed with auto ones | Hans |
| PA-4 | Assumed the vendor live-stream tracker (Module 6A, `VND-`) reports actual hours back into `PLAN_ACTUAL`. If the vendor reports outside the system, live hours become manual entry | Hans / Yohan |
| PA-5 | Assumed force-close (`Ditutup Otomatis`) fires at period end + 7 days. Not yet confirmed | Yulianti |
| PA-6 | Assumed clients see closed and active Plan periods through the same link as the Strategi, not a separate link | Yohan |
| PA-7 | Assumed a carried row (`Terbawa`) does not increase the next period's target — the deficit is tracked separately at contract level rather than double-counted | Yohan |
| PA-8 | Still open from 6A: the catalog invariant test asserts a literal `== 15`; the v2 amendment now covers 25 events and needs the same sign-off | Hans |

---

## 10. Success Metrics

**Activation event.** First period closed with complete actuals and a completed review — not "Plan created".

**North star.** % of active contracts whose current period is `Aktif` with a closed, complete previous period. Target ≥ 90%. This single metric catches the two ways Plan dies: never filled, or filled and never closed.

| Metric | Why | Target |
|---|---|---|
| % periods closed by AM vs `Ditutup Otomatis` | Auto-close means the loop was abandoned | ≥ 85% AM-closed |
| Median days from period close → actuals complete | The manual GMV field is the weak link (Rule 11) | ≤ 3 days |
| % rows with a Brief created | Measures whether Plan is the real source of work or theatre | ≥ 90% of `Wajib` rows |
| % rows flagged `Di Luar Strategi` | Rising = strategy is being bypassed, or the strategy was wrong | < 15% |
| Downward target adjustments per contract | The metric §3 exists to expose. Watch the distribution per AM, not the average | tracked per AM |
| Cumulative actual vs **original** Strategi target | The only number that cannot be edited by the party being measured | tracked |
| % periods where PF-3 distinguishes strategy-fault from execution-fault with cited evidence | Tests whether the review is real or ritual | ≥ 80% |

**Anti-vanity guard.** Do not report "% Plan completion" as a headline — it rises when an AM marks rows `Selesai` generously. Pair it with the Brief-creation rate and cumulative actual vs original target, which cannot be moved by form-filling.
