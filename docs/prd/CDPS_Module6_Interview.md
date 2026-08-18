# CDPS — Module 6 (Interview): **Kelola Klien → Interview & Kualifikasi**

> **Scope of this document.** The field-level and behavioural specification of the **Interview** step (entity `ITV-`, "Kualifikasi Klien") inside the client-management flow that Account Service runs after a client is handed over from Sales. It also specifies **Riset Awal** (the mandatory baseline step that precedes Interview) and the two things people keep confusing: the client-qualification **Blok C verdict** and the store-analysis **Skor Kondisi Toko**.
>
> **Why this document exists.** The Interview module was built before it had a PRD; its rules ended up scattered across `docs/DECISIONS.md`, `docs/STATE_MACHINES.md`, the handoff chain (SESI27–31), and the code itself. That scatter is the **root of the drift** the owner kept feeling ("a decision written in three places, contradicting itself"). This file is the single canonical spec. Where it and older text disagree, **this document plus the owner decisions logged in `DECISIONS.md` win** (SESI31 §0.2 — the owner suspended CLAUDE.md's "PRD wins" rule for the five RAB-19 points; those corrections are folded in here).
>
> **Body text: English. Field labels, statuses, verdicts, and BI messages: Bahasa Indonesia** (CDPS convention). BI validation strings are quoted verbatim in `[...]`.

## Contents
1. Background
2. Locked decisions (owner + logged)
3. The 5-step Kelola Klien flow
4. Riset Awal (step 1) — the mandatory baseline
5. Interview state machine (mesin #19)
6. Interview sections (Blok B) and the 12-section status map
7. Dedup — every number asked once
8. Blok C scoring & verdict (client qualification)
9. **The hard boundary: Skor Kondisi Toko vs Blok C verdict**
10. Interview → Strategi handoff (prefill)
11. Permissions & visibility
12. Kelola Klien SLA timeline
13. Example — Alpha Digital
14. System Requirements
15. Open Assumptions
16. Success Metrics

---

## 1. Background

**Problem.** For a full-management client the "qualification" and "context gathering" happened in an AM's head, a chat thread, or a form Sales filled once at closing. Consequences: (a) the same numbers — GMV, target, budget, category, store link — were asked **three times** (at `clients` intake, in `qualified_forms`, and again during strategy baseline), each copy free to drift; (b) whether a client is actually a good fit was a matter of opinion, decided after the contract was signed; (c) the client's real store condition (is the store already working, or does it need to be rebuilt?) was never captured in a form the strategy could inherit; (d) nothing forced the AM to look at real store numbers before the interview, so the interview asked questions the data already answered.

**Why now.** The owner handed over a working baseline-analysis tool (TikTok Shop seller-centre + Ads Manager export → five-pillar store score) and set a five-step flow (§3). CDPS already gates Briefs behind a Strategi; the missing pieces were (i) a baseline step that must run **before** the interview and feeds it, (ii) an interview that asks **only what the data does not already say**, and (iii) a qualification score that is **server-authoritative** and cannot be nudged by a hand-edited request.

**Expected outcome.** One `ITV-` record per contract that: forces Riset Awal first; asks each mandatory number exactly once; produces a defensible **Blok C verdict** (client fit) that is advisory, never a hard gate; keeps that verdict strictly separate from the **Skor Kondisi Toko** (store health); and mechanically prefills the Strategi that follows.

**Source of truth for this module (code the PRD describes).**
- Scorer, states, prefill, SLA, enums: `packages/core/src/interview.ts`.
- Domain orchestration, permissions, riset-awal gate, `scoreInterview`: `packages/domain/src/interview.ts`.
- Sections & built fields: `web-internal/src/lib/interview-fields.ts`; FE edges: `web-internal/src/lib/interview.ts`; dedup: `web-internal/src/lib/interview-dedup.ts`.
- Migrations: `20260811030000_interview.sql` (ITV, tables, mesin #19, RLS), `20260812000000_interview_mulai_tanpa_jadwal.sql` (direct-start edges), `20260812100000_interview_riset_awal.sql` (mesin #20), `20260817000000_riset_awal_baseline_schema.sql` (four baseline tables), `20260811050000_interview_verdict_view.sql` (Sales verdict view).

---

## 2. Locked decisions (owner + logged)

Owner decisions of 2026-08-17 (SESI31 §1) and the RAB decisions of 2026-08-18 (`DECISIONS.md`).

| # | Decision | Value |
|---|---|---|
| D1 | Analysis numbers are **proposals; the AM confirms each number** | The recorded value is the *confirmed* one; the original proposal is frozen in `nilai_usulan`. A parser bug cannot move a verdict without a human approving. |
| D2 | **Riset Awal is mandatory before Interview** | Enforced per active platform at the two start transitions (§4). Not `RA-1` (that was an SLA, closed 2026-08-13). |
| D3 | Brief = **one click, inherit everything** | On Plan activation, plan rows descend into Briefs; the AM fills only due date + priority. (Specified in M6B; implemented RAB-16.) |
| D4 | **Direct port** of the owner's baseline tool | No HTML rework round; the 15 tool findings are fixed once in CDPS, with tests. |
| D5 | Platforms without an analysis engine → **minimal manual entry** | GMV/month · orders · AOV · SKU count · ad spend · ROAS. Field expansion is registered in this PRD. |
| D6 | Entity = **`STRG-` (`strategi`) + M6B (`plan`)** going forward | STR- (`strategy_plans`) is **not** retired yet (RAB-17). |
| D7 | The tool's finding label = **TANTANGAN** | Blok C keeps **HAMBATAN MENDASAR** — the two vocabularies never overlap (§9). |
| D8 | Interview ID prefix = **`ITV`** | Format `ITV-YYYYMM-NNNN` via `ident_next` (house rule #1), not `ITV-YYYY-NNNNN`. |
| D9 | Blok C verdict is **advisory** | No routing enum, no reject path, no override column. It informs; it never blocks Strategi. |
| D10 | Blok C scorer is **server-authoritative** | One pure function for preview and submit (preview = submit); confirmed Riset Awal inputs are server-merged before scoring (D1). |
| D11 | **Kondisi Toko ≠ verdict** | Store health and client fit are different measurements with disjoint vocabularies; merging them is a CI-red offence (§9). |

---

## 3. The 5-step Kelola Klien flow

The owner-defined lifecycle (SESI31 §0.1). Steps 1–3 are the *measured* "Kelola Klien" span (each with an SLA, §12):

1. **Klien masuk** → managed by the Account Service team (handover from Sales/M0).
2. **Riset Awal** — the AM logs into the client's store and records the baseline via the seller-centre export tool; some Riset Awal fields auto-fill (§4).
3. **Interview** — the AM schedules and asks **only what is not already in the client's data** (§6, §7).
4. **Strategi** — the AM composes the Strategi (Module 6A); needs ACC Head/SPV approval.
5. **Brief** — one click: the Strategi/Plan is inherited into Briefs for the relevant divisions; the AM fills only the rest (Module 6B, RAB-16).

Opening "Kelola Klien" **resumes** the client's open session or mints a fresh `ITV-` if none is open (`openKelolaKlien`); it does **not** mint a new interview on every click — that would move the Riset Awal start anchor and corrupt the SLA measurement.

---

## 4. Riset Awal (step 1) — the mandatory baseline

**What it is.** Before any interview, the AM opens the client's store and captures the baseline. For TikTok Shop this runs through the analysis engine (seller-centre + Ads Manager export); for platforms without an engine it is minimal manual entry (D5).

### 4.1 Machine #20 (`riset_awal`)
- States: **`Berjalan` → `Selesai`** (`Selesai` terminal, no re-open edge). Driven exclusively by `sm_transition(machine='riset_awal', table='interview_riset_awal', id_col='interview_id')`.
- Table `interview_riset_awal` is a 1:1 child of `interview`, **PK = `interview_id`** — no own ID prefix. Born in the **same transaction** as the interview when the AM clicks "Kelola Klien" (`createInterview` → `startRisetAwal`). There is **no "start" button**; opening the page *is* the start (`dimulai_pada`).
- `submitRisetAwal` stamps `disubmit_pada`/`disubmit_oleh` and transitions in one transaction. A second submit is a `ConflictError [riset awal sudah disubmit]`, not a no-op.
- **Duration is not a stored column** — derived at read (`disubmit_pada − dimulai_pada`, floored minutes); `—` while running (house rules #4/#7).
- Anchors are frozen by trigger `trg_riset_awal_jangkar`: changing `dimulai_pada`, overwriting `disubmit_pada`, or reverting from `Selesai` is rejected in the DB, even on service-role.
- `retroaktif` flag: sessions backfilled before this feature show a duration but are never judged against the SLA (mirrors `interview.retroaktif`).

### 4.2 Prerequisite gate (D2 / RAB-07)
`assertRisetAwalGate` runs at the two start transitions — `scheduleInterview → Terjadwal` and `transitionInterview → Sedang Berlangsung`. It is **per active platform** (anti-deadlock) and requires all three:
1. Riset Awal submitted (`interview_riset_awal.status = 'Selesai'`).
2. **Every** active `client_platforms` row has a baseline row (`riset_awal_analisa`, analysis or manual) for this interview.
3. Every auto-filled isian is confirmed (`interview_riset_awal_isian.dikonfirmasi = true`).

On failure: `[riset awal belum selesai — setiap platform aktif wajib punya baseline yang terkonfirmasi dan riset awal disubmit sebelum interview dimulai]`. Anti-deadlock: a Shopee-only client whose baseline is *manual* still satisfies the gate — the gate needs a baseline **row** per platform, not an analysis score.

### 4.3 Baseline tables (RAB-01) — no new ID prefix
- **`riset_awal_analisa`** — one immutable row per (riset awal × active platform). `metode_baseline ∈ {analisa_penuh, analisa_tipis, manual}`; `payload jsonb` (frozen); `kondisi_toko` (5-value, §9); `skor` (NULL unless `analisa_penuh`); provenance `benchmark_versi` + `parser_versi`; `cakupan_riwayat ∈ {cukup, kurang}`. CHECKs enforce: `manual ⇒ kondisi_toko='belum_dapat_diukur' AND skor IS NULL`; any `skor` requires `analisa_penuh` + full provenance.
- **`riset_awal_sumber_berkas`** — export provenance: `nama_berkas`, `sha256` (frozen), `ukuran_bytes`, `tipe_terdeteksi`, `tipe_override` (the only editable column), `periode`, `tanggal_ambil`. This legitimately fills Module 6A's `sumber_data` + `lampiran` (M6A Rule 5) — i.e. RAB-19's correction: the baseline source may now be an export the AM pulled, not only hand-typed numbers.
- **`interview_riset_awal_isian`** — the answer-row pattern (`interview_answer` shape): PK `(interview_id, section, field_key)`, typed `nilai_*`, `sumber ∈ {analisa, manual, sales}`, `nilai_usulan jsonb` (frozen), `dikonfirmasi`. An `analisa` source requires a `nilai_usulan`; a trigger freezes `nilai_usulan` + `sumber`.
- **`riset_awal_benchmark`** — versioned (`versi` PK), Director-only (default-deny RLS), append-only. Version 1 seeds the 16 TikTok thresholds.

### 4.4 Auto-fill into the interview (RAB-05)
Only two isian keys flow into Blok C scoring — `RISET_AWAL_SCORED_KEYS = ['B2-9', 'B2-3']`:
- `toko.aov` → **B2-9** (AOV) → C-A3.
- `produk.sku_total` → **B2-3** (SKU count) → C-C3.

`median_6m` / `runrate_3m` / `roas` / `arah_strategi` stay in the payload for the **Strategi** baseline (RAB-11), **not** the interview. In particular `median_6m` is deliberately **not** mapped to `B1-5`: the units differ ~3× (median_6m is Rp/month over 6 months; B1-5 is 3-month total revenue, the denominator of C-E1), and mapping it would deflate the denominator and falsely trip the `rasio_target_terlalu_tinggi` deal-breaker. `B3-3` (price room) and `B7-3` (access readiness) **stay interview questions** — human judgment, not in any spreadsheet.

### 4.5 The `belum_dapat_diukur` vocabulary (RAB-03)
`kondisi_toko` is a 5-value set (NOT a `verdict`): `mesin_jalan`, `mesin_sebagian`, `fondasi_perlu_dibenahi`, `mesin_belum_terbangun`, **`belum_dapat_diukur`**.
- `mesin_belum_terbangun` = "analysis ran; the store is genuinely weak."
- `belum_dapat_diukur` = "no analysis engine exists for this platform yet."
Merging the two would defame a healthy Shopee store that simply has no TikTok engine. `belum_dapat_diukur` must **never** raise a TANTANGAN. Per-platform mapping today: TikTok Shop = `analisa_penuh` (five pillars, computed `skor`); Tokopedia = `analisa_tipis` (`belum_dapat_diukur`); Shopee / Lazada / Website / lainnya = `manual` (`belum_dapat_diukur`).

---

## 5. Interview state machine (mesin #19, `interview`)

The `status` column moves **only** through `sm_transition` (house rule #2). Initial state **`Belum Dijadwalkan`**; terminals **`Selesai`**, **`Selesai Dengan Catatan`**, **`Dibatalkan`**. Eleven statuses:

`Belum Dijadwalkan`, `Terjadwal`, `Dijadwalkan Ulang`, `Sedang Berlangsung`, `Draft Isian`, `Butuh Data Klien`, `Diajukan`, `Selesai`, `Selesai Dengan Catatan`, `Dikembalikan`, `Dibatalkan`.

### 5.1 Edges (`sm_edges`; `require_lead` marks reviewer/lead-only)

| From | To | require_lead |
|---|---|---|
| Belum Dijadwalkan | Terjadwal | false |
| Belum Dijadwalkan | Sedang Berlangsung | false *(direct start — mig. 20260812000000)* |
| Terjadwal | Sedang Berlangsung | false |
| Terjadwal | Dijadwalkan Ulang | false |
| Dijadwalkan Ulang | Terjadwal | false |
| Dijadwalkan Ulang | Sedang Berlangsung | false *(direct start — mig. 20260812000000)* |
| Sedang Berlangsung | Draft Isian | false |
| Draft Isian | Diajukan | false |
| Draft Isian | Butuh Data Klien | false |
| Butuh Data Klien | Draft Isian | false |
| Diajukan | Selesai | false |
| Diajukan | Selesai Dengan Catatan | **true** |
| Diajukan | Dikembalikan | **true** |
| Dikembalikan | Draft Isian | false |
| *(any non-terminal)* | Dibatalkan | **true**, reason required |

The `Belum Dijadwalkan / Dijadwalkan Ulang → Sedang Berlangsung` edges are the "start now, schedule never" path (a client who is suddenly ready). `Dibatalkan` needs `alasan_pembatalan`, written in the same transaction (DB CHECK `ck_interview_batal_alasan`). Reviewer edges are Account-lead/Director only.

### 5.2 Completion gate for Strategi
`INTERVIEW_COMPLETE_STATES = [Selesai, Selesai Dengan Catatan]`. **Completion — not the verdict value — is the only prerequisite for creating a Strategi** (D9). A `tidak_siap` verdict does not block; it only pings the SPV.

### 5.3 Jadwal & BI messages
Jadwal `format` closed set (CHECK `ck_jadwal_format`): `Onsite`, `Video Call`, `Telepon`, `Chat`; `durasi_menit > 0`. Verbatim BI messages (`packages/domain/src/interview.ts`):
- `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`
- `[Anda tidak memiliki akses ke interview ini.]`
- `[interview tidak ditemukan]`
- `[alasan pembatalan wajib diisi]`
- `[format interview tidak valid]` · `[durasi interview tidak valid]`
- `[riset awal tidak ditemukan]` · `[riset awal sudah disubmit]`
- `[riset awal belum selesai — setiap platform aktif wajib punya baseline yang terkonfirmasi dan riset awal disubmit sebelum interview dimulai]`

---

## 6. Interview sections (Blok B) and the 12-section status map

The interview form is organised into twelve sections, `B0`–`B11`. Each carries an explicit `SectionStatus` (RAB-10), so "not built" is a **declared state**, not an accident:

| Code | Label | Status | Built? |
|---|---|---|---|
| B0 | Konteks & Sumber Data | `ditunda_rab18` | no |
| B1 | Model & Skala Bisnis | `wired` | **yes** |
| B2 | Produk, Margin & Suplai | `wired` | **yes** |
| B3 | Posisi Harga | `wired` | **yes** |
| B4 | Operasional & Layanan | `wired` | **yes** |
| B5 | Kompetisi | `ditunda_rab18` | no |
| B6 | Ekspektasi & Budget | `wired` | **yes** |
| B7 | Kesiapan Kerja Sama | `wired` | **yes** |
| B8 | Harga & Penawaran | `ditunda_rab18` | no |
| B9 | Kategori (config-driven) | `config_driven` | no |
| B10 | Riwayat & Ekspektasi Lain | `ditunda_rab18` | no |
| B11 | Catatan Internal | `ditunda_rab18` | no |

**Built (wired): B1, B2, B3, B4, B6, B7.** Deliberately deferred to *this* PRD: **B0, B5, B8, B10, B11**. **B9** is `config_driven` (a category-specific set served when a config route provides it; table `interview_kategori_blok` exists). The reason the deferred sections were not stubbed: there is no server-side question catalog for their descriptive fields, so building inputs would mean **inventing ~80 field keys the scorer never reads** — CLAUDE.md forbids inventing fields. This PRD is what unblocks them: it defines their questions before the code.

### 6.1 The 18 built fields (`INTERVIEW_FIELDS`)
Answers are stored in `interview_answer` rows `(interview_id, section, field_key)` with typed columns (`nilai_teks/angka/uang/bool/enum/jsonb`), plus `sumber_angka`, `dasar_estimasi`, `wajib_kosong`. Money is stored in **IDR minor units** (1/100 rupiah) on the wire and in the scorer; conversion is centralized in `rupiahToMinor`/`minorToRupiah`.

| field_key | section | label | tipe | drives | scored |
|---|---|---|---|---|---|
| B1-4 | B1 | Model bisnis / sumber stok | enum | C-B1 | yes |
| B1-5 | B1 | Omzet 3 bulan terakhir | money | C-A1 · denom C-E1 | yes |
| B2-7 | B2 | Margin bersih (%) | persen | C-A2 | yes |
| B2-7a | B2 | Komisi platform (%) | persen | (derivation input) | no |
| B2-7b | B2 | Ongkir ditanggung (%) | persen | (derivation input) | no |
| B2-8 | B2 | Margin kotor (%) | persen | C-A2 (basis) | yes |
| B2-9 | B2 | AOV (nilai order rata-rata) | money | C-A3 | yes |
| B2-3 | B2 | Jumlah SKU siap jual | angka | C-C3 | yes |
| B2-10 | B2 | Pembeda produk | enum | C-C2 | yes |
| B2-11 | B2 | Siklus beli ulang | enum | C-C1 | yes |
| B2-13 | B2 | Kesanggupan lonjakan 3×/30 hari | enum | C-B2 | yes |
| B3-3 | B3 | Ruang harga | enum | C-A4 | yes |
| B4-9 | B4 | Penanganan chat | enum | C-D1 | yes |
| B6-3 | B6 | Target omzet 3 bulan | money | C-E1 | yes |
| B6-5 | B6 | Daya tahan budget iklan | enum | C-E2 | yes |
| B7-3 | B7 | Kesiapan akses | enum | C-D3 | yes |
| B7-6 | B7 | Kecepatan approval | enum | C-D2 | yes |
| B7-9 | B7 | Prasyarat dari klien | teks | Prasyarat · Strategi C-7 | no |

`PRASYARAT_FIELD_KEY = 'B7-9'` (surfaced on the client print view).

### 6.2 Number source (I3)
`sumber_angka ∈ {klien_hitung, dari_margin_kotor, estimasi_am}`. `dari_margin_kotor` is offered only on B2-7. `estimasi_am` requires a written basis (`dasar_estimasi`, DB CHECK `ck_answer_estimasi_basis`). Rule of thumb: **ask first, estimate second, never leave blank** — a scored field may never be `wajib_kosong` (DB CHECK `ck_answer_scored_not_blank`).

---

## 7. Dedup — every number asked once (RAB-08)

Before dedup, GMV / target / budget / category / store were asked **three times** (`clients`, `qualified_forms`, `strategi_baseline_bulan`). Rule: **each mandatory number has exactly one source of truth; the interview does not re-ask it.**

- **B2-9 (AOV)** and **B2-3 (SKU count)** are no longer asked in Blok B — they come from Riset Awal (§4.4) and are authoritative in scoring (§8, RAB-06). They render as a "terisi dari data" chip with a **"berbeda dari data"** button that routes any correction back to the **Riset Awal** step (the single source of truth), not into a second interview copy. The draft is seeded from the confirmed isian so the live score preview stays complete (preview = submit).
- Identity + store baseline from `clients` (a snapshot of `qualified_forms`) is shown **read-only** via the Sales-context card; corrections go through the Client Record (Module 4).
- The dedup set is deliberately **narrow**: `gmv_baseline` / `target_gmv` are *not* collapsed into scored fields (the `median_6m → B1-5` unit mismatch), and `B1-5` / `B3-3` / `B7-3` remain interview questions because they need human judgment.

---

## 8. Blok C scoring & verdict (client qualification)

Blok C measures **whether this client is a good fit for MEA** — not how healthy their store is (§9).

### 8.1 The scorer
One pure function `hitungKualifikasi` (100 points) is used for **both** live preview and submit (preview = submit), and its result is persisted through the single write path `persistKualifikasi`. The 15 scored inputs are `SCORED_FIELD_KEYS` (**do not modify** — mirrored by DB CHECK `ck_answer_scored_not_blank`):

`B1-4, B1-5, B2-3, B2-7, B2-8, B2-9, B2-10, B2-11, B2-13, B3-3, B4-9, B6-3, B6-5, B7-3, B7-6`.

Five blocks: **A Ekonomi Unit (30) · B Kesiapan Suplai (20) · C Produk & Pasar (20) · D Kesiapan Operasional (15) · E Ekspektasi & Daya Tahan (15).** BEP ROAS = 100 ÷ net-margin% (computed, never typed). Money is in minor units.

### 8.2 The verdict
`hitungVerdict` returns one of `VERDICT = {growth_ready, bersyarat, risiko_tinggi, tidak_siap}`:
- Any **deal-breaker** forces `tidak_siap` (absolute, first branch, no override).
- Else `≥ skorGrowthReady (75) → growth_ready`; `≥ skorBersyaratMin (55) → bersyarat`; else `risiko_tinggi`.

Thresholds live in `KualifikasiConfig`, snapshotted per interview (`config_snapshot`) so a later config change never rewrites an old verdict. Four deal-breaker codes (`HAMBATAN`): `margin_di_bawah_minimum` (C-A2 < 15%), `dropship` (C-B1), `rasio_target_terlalu_tinggi` (C-E1 > 5×), `daya_tahan_budget_terlalu_pendek` (C-E2 ≤ 1 month).

### 8.3 Server-authoritative inputs (RAB-06)
Before scoring, `scoreInterview` calls `mergeRisetAwalScoredInputs`: for B2-9/B2-3 the **confirmed Riset Awal isian** overrides whatever the `/score` request body carries. A hand-posted AOV or SKU count cannot move the verdict away from the baseline the AM signed. If there is no confirmed isian (an interview without Riset Awal, e.g. the Alpha Digital fixture), the body is used as-is and the score is identical.

### 8.4 The verdict never blocks
There is no routing enum, no reject path, no override column. When the verdict is `tidak_siap`, `scoreInterview` emits an informational `kualifikasi_tidak_siap` notification to SPV / Head of Account — nothing more.

---

## 9. The hard boundary: Skor Kondisi Toko vs Blok C verdict

**Two different measurements with near-colliding names. They must never be merged** — merging would let store performance decide client eligibility, which is inverted logic: a weak store is the *reason* to hire MEA, not a reason to reject the client.

| | **Blok C verdict** (client fit — §8) | **Skor Kondisi Toko** (store health — §4) |
|---|---|---|
| Values | `growth_ready` / `bersyarat` / `risiko_tinggi` / `tidak_siap` | `mesin_jalan` / `mesin_sebagian` / `fondasi_perlu_dibenahi` / `mesin_belum_terbangun` / `belum_dapat_diukur` |
| Problem label | **HAMBATAN MENDASAR** (4 fixed deal-breaker codes) | **TANTANGAN** (+ PERHATIAN / CATATAN / MODAL) |
| Data-quality flag | `KUALITAS_DATA` (`terverifikasi` / `sebagian_estimasi` / `mayoritas_estimasi`) | `cakupan_riwayat` (`cukup` / `kurang`) |
| Stored in | `interview_kualifikasi.verdict_kualifikasi` | `riset_awal_analisa.kondisi_toko` (a `kondisi_toko`, **never** a `verdict`) |

Three permanent safeguards (SESI31 §2.3 / RAB-03): (1) `kondisi_toko` is its own 5-value column whose vocabulary is **disjoint** from `VERDICT`; (2) a CI test asserts `enum(Blok C) ∩ enum(Kondisi Toko) = ∅` (intersection → red); (3) a test asserts Kondisi Toko can never trigger `kualifikasi_tidak_siap` or the Blok C gate. `belum_dapat_diukur` produces **zero** TANTANGAN.

**Worked example (why both are right).** A store with GMV down 14%, refund 6.2%, only 3 LIVE sessions, top-5 creators at 71% → **Skor Kondisi Toko ≈ 38** (`fondasi_perlu_dibenahi`, TANTANGAN). The *same* client with 32% margin, own production, target ratio 1.46×, 6-month budget durability → **Blok C ≈ 82 `growth_ready`**. Both are correct: the store is troubled, the client is worthy — the ideal MEA client.

---

## 10. Interview → Strategi handoff (prefill)

`PREFILL_MAPPING` maps confirmed interview fields onto Strategi Section A/C/E fields (e.g. `B2-8 → A-3` uses **gross** margin; `B7-9 → C-7` carries the client prasyarat; `B8-1 → E-4` is a floor-price **candidate**, suggestion only). A prefilled Strategi field carries `sumber='interview'` and stays AM-editable ("usulan → konfirmasi").

`STRATEGI_BASELINE_FORBIDDEN_PREFILL` (Strategi Section B numeric baseline, B-1..B-8) is **never** prefilled from the interview — the Strategi baseline stays manual with attached exports.

`handoffKeStrategi(verdict)` never blocks Strategi creation — every branch returns `unlocked: true` — and instead attaches flags: `bersyarat → [sasaran_konservatif]` (copy prasyarat to C-7); `risiko_tinggi → [risiko_tinggi]` (require mitigation note); `tidak_siap → [sasaran_konservatif, hambatan_mendasar_tercatat]` (both). Live path (RAB-09): domain `getStrategiPrefill` / `getBaselinePrefill` → `GET /strategi/{id}/prefill` and `/baseline-prefill`, linked by `client_id` + `latestScoredInterview` (there is no `interview_id` column on `strategi`). No writes, no migration; many prefill sources live in the deferred sections, so today's live prefill surface is small but forward-compatible.

---

## 11. Permissions & visibility

- **Full interview** (`getInterview`): record + answers + full Blok C (score, verdict, breakdown). Scope = **Account only**: the assigned AM, Account lead/SPV, OD (read-only), Director. **Sales is denied.**
- **Verdict only** (`getInterviewVerdict`): verdict + `prasyarat_status` **only** — no score, no breakdown, no answers. Adds the closing salesperson / Sales lead to the full-read set (mirrors the additive `interview_verdict` view row-for-row).
- **Writes**: assigned AM, Account lead/SPV, or Director; OD never writes. All writes run on service-role; RLS write policies are default-deny.
- **Hard-internal fields** (`HARD_INTERNAL_FIELD_KEYS`, never Sales/client-visible): all Blok C (`C` / `C-*`), all `B11-*`, plus `B2-7`, `B2-8`, `B5-9`, `B6-5`, `B6-6`.
- `prasyarat_status ∈ {belum, jalan, selesai}`; `resolvePrasyarat` (the "tandai prasyarat selesai" button) flips it to `selesai` — advisory, idempotent, blocks nothing; it stops the daily overdue flag.

Versioning (I9): `versi_no` (default 1), `interview_induk_id`, `versi_sebelumnya_id`; a re-interview mints version n+1 (CHECK `ck_interview_lineage`). One active interview per contract (partial unique `uq_interview_aktif_per_kontrak` where status is non-terminal). `interview_profile` default `full_management` (Blok C runs for full-management).

---

## 12. Kelola Klien SLA timeline

A **measurement**, not a machine (`kelola_klien_sla_config` v1; working days Mon–Fri minus `hari_libur`, via SQL `working_days_between`). Statuses: `belum_mulai`, `tepat_waktu`, `mendekati_batas`, `terlambat`, `tidak_berlaku`.

| Step | target–batas (working days) | start anchor | done anchor |
|---|---|---|---|
| 1 · Riset Awal | 2–3 | `interview_riset_awal.dimulai_pada` (klik Kelola Klien) | `disubmit_pada` |
| 2 · Interview Meeting | 1–2 | `disubmit_pada` | `interview.meeting_diamankan_pada` (first of → Terjadwal / → Sedang Berlangsung) |
| 3 · Brand Strategy | 5–7 | `interview.selesai_pada` (→ Selesai / Selesai Dengan Catatan) | `strategi.diajukan_pada` **or** `strategy_plans.diajukan_pada` |

Anchors 2 & 3 are stamped by trigger `trg_interview_stamp_timeline`. Over-batas raises an `interview_flag` from `interview_daily_tick` (`sla_riset_awal_terlambat` / `sla_meeting_terlambat` / `sla_strategi_terlambat`), once per interview, `retroaktif` excluded. Step 3 is `tidak_berlaku` only when the service's plan gate decides `tanpa_plan`.

---

## 13. Example — Alpha Digital

Alpha Digital (the seed fixture) is a full-management TikTok Shop + Shopee client. Flow: the AM opens Kelola Klien → a `riset_awal` (`Berjalan`) and `ITV-YYYYMM-NNNN` are born together. The AM pulls the TikTok seller-centre + Ads export → `riset_awal_analisa` (`analisa_penuh`, a computed `skor`, `kondisi_toko`) and pulls Shopee manually → a `manual` row (`belum_dapat_diukur`). AOV and SKU auto-fill B2-9/B2-3 (confirmed). Riset Awal is submitted → the prerequisite gate opens → the interview starts. The AM answers Blok B (asking only what the data did not already say); Blok C scores server-side. A troubled TikTok store (low Skor Kondisi Toko, TANTANGAN) with strong economics (high Blok C, `growth_ready`) is exactly the client MEA wants — the two scores stay separate, and neither blocks the Strategi that follows.

*Note:* the automated fixture used in tests seeds an interview **without** a Riset Awal to prove Blok C scores identically when no confirmed isian exists (§8.3); the product flow above always runs Riset Awal first.

---

## 14. System Requirements

- Entity `ITV` registered in `entity_prefix`; ID `ITV-YYYYMM-NNNN` via `ident_next` (house rule #1). Riset Awal + the four baseline tables have **no** prefix (natural / identity keys).
- Machines: #19 `interview`, #20 `riset_awal` — status only via `sm_transition`; edges as in §5.1 and §4.1.
- All history append-only; scores/verdicts/durations are **derived and recomputable** (house rules #3/#4). Frozen anchors and `nilai_usulan` are enforced by triggers, not convention.
- Scorer is a single pure function shared by preview and submit; the only write path is `persistKualifikasi`. Confirmed Riset Awal inputs are server-merged before scoring.
- BI validation strings exactly as in §5.3. IDR rendered `Rp. X.XXX.XXX,00`; division-by-zero renders `—`.
- Two disjoint-vocabulary CI tests (verdict ∩ kondisi_toko = ∅; Kondisi Toko cannot trigger the Blok C gate) stay green.

---

## 15. Open Assumptions

1. **Deferred sections B0/B5/B8/B10/B11.** This PRD declares them; their concrete field keys, types, and (for B8) the price/offer structure are specified here at the section level but the individual `field_key`s are added when each section is built — no field is invented ahead of a question it answers.
2. **B9 (category-driven).** The category question set is config-driven (`interview_kategori_blok`); the config content per category is an owner input, not fixed here.
3. **Manual-platform field expansion (D5).** When an analysis engine for Shopee/Lazada arrives, the minimal manual set (GMV/orders/AOV/SKU/ad-spend/ROAS) expands; the expansion is registered against this PRD, and the adapter registry means adding an engine = plugging an adapter, not rewriting the interview.
4. **`STATE_MACHINES.md §6f`** should gain an explicit "gerbang prasyarat" subsection describing `assertRisetAwalGate` (tracked as RAB-20). The gate itself is authoritative in code today.

---

## 16. Success Metrics

- **Zero triple-asks:** no mandatory number (GMV / target / budget / category / store / AOV / SKU) is entered more than once across `clients` / Riset Awal / interview.
- **Gate adherence:** 100% of started interviews have a submitted Riset Awal with a confirmed baseline per active platform (the gate makes this structural).
- **Verdict integrity:** no verdict ever changes without a human-confirmed input (server-merge + frozen `nilai_usulan`); the verdict∩kondisi_toko CI test never goes red.
- **Handoff completeness:** every completed interview yields a prefilled Strategi draft (suggestion-only), reducing Strategi start time.
- **SLA visibility:** every Kelola Klien session shows a live 3-step SLA status; over-batas steps raise exactly one flag each.
