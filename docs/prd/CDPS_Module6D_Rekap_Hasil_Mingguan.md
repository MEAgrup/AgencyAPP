# CDPS — Module 6D: **Rekap Hasil Mingguan** (Weekly Result Update)

> **Scope.** The screen and entity where the **AM/CRO** reviews and updates, **once a week, per client**, the consolidated delivery result across all four execution divisions — *"Creative bikin berapa video, Live Stream berapa live, KOL berapa creator"* — together with the movement metrics that matter (total view, GMV, CTR, CVR, ROAS). It is the operational weekly cadence that **rolls up into** the monthly Plan realisasi (Module 6B §5 P-E); it does **not** replace it.
>
> Companion to Module 6A (Strategi), 6B (Plan), 6C (Plan-gate & Plan Satuan). **Body: English. Field labels, statuses, UI copy: Bahasa Indonesia.**

## Contents
1. Background
2. Locked decisions
3. The single-source-of-truth risk — and the guardrail
4. Rules
5. Form structure — Section RM-A → RM-F
6. Flow
7. Example — Alpha Digital, minggu 3
8. System Requirements
9. Open Assumptions
10. Success Metrics

---

## 1. Background

**Problem.** After the AM/CRO breaks a Service into Briefs and fans them out to Creative / Ads / KOL / Live Stream (Module 6 §5–6), the system tracks each Brief's *status* (`[Submitted]`, `[Approved]`, revision count) and — for plan-gated services — a *monthly* actuals close (Module 6B §5 P-E). What it does **not** have is the thing the AM/CRO actually does every week: sit down, look across every division at once, and answer *"how much did we actually produce this week, and did the numbers move?"* Today that recap lives in a spreadsheet or a WhatsApp voice note. The consequences are the familiar three: the client's weekly check-in is prepared from memory; a division that quietly under-produced for two weeks is invisible until the monthly close; and services running **without** a Plan (Direct-path per Module 6 §2, or `Tanpa Plan` per Module 6C) have **no periodic results record at all** — they are executed entirely outside the system's knowledge until a complaint arrives.

**Why now.** Modules 7–10 already capture the raw production and metrics (approved Assets, weekly Ads Metric Entries, QC-passed Bookings, reconciled Live Stream Sessions). Module 6B already defines the monthly accountability close. The missing layer is the **weekly consolidation** that sits between them — the layer that the Phase 0 flow already assumed ("Each division sends **weekly + monthly reports** back to Account", Phase 0 v2 §diagram step 6) but that was never built as a CDPS feature (Phase 0 OA-11 resolved the *client-facing* report to the external `mea-client-reporting` system, leaving the *internal* weekly recap unspecified). This module specifies it.

**Expected outcome.** One weekly recap record per active client that (i) shows per-division production counts for the week — videos, lives, creators — pulled automatically from the execution modules; (ii) shows the consolidated movement metrics (total view, GMV, CTR, CVR, ROAS) from the sources that own them, with an explicit manual-entry fallback for what the system does not yet own; (iii) carries the AM/CRO's short narrative (what moved, what is blocked, next week's focus and client talking points); and (iv) rolls up into the monthly Plan realisasi (Module 6B P-E) at period close — while never becoming a second source of truth for the one number that must stay single-sourced: monthly GMV.

---

## 2. Locked decisions

| # | Decision | Value | Source |
|---|---|---|---|
| R1 | Relationship to the monthly Plan | **New weekly layer that feeds the monthly Plan (M6B P-E).** Plan stays the monthly accountability layer; the recap is the weekly operational cadence that rolls up into it. It never re-computes or overwrites the Plan's monthly manual GMV | Owner decision, `DECISIONS.md` 2026-08-12 |
| R2 | Coverage | **Every active client, cross-division, Plan or no Plan.** Client-level, spanning Creative/Ads/KOL/Live Stream — including Direct-path and `Tanpa Plan` services, which today have no periodic results record | Owner decision, `DECISIONS.md` 2026-08-12 |
| R3 | Metrics not yet modelled (CTR across non-Ads channels, organic video views, CPL, impressions) | **Reuse what the system already owns; manual entry (with source + date) for the rest, or render `—`.** No new auto pipeline is invented in this module | Owner decision, `DECISIONS.md` 2026-08-12 |
| R4 | Who owns/authors it | **AM/CRO alone**, per Module 6 (AM and CRO are the same function — `DECISIONS.md` 2026-08-04). Divisions contribute by doing the work (their numbers auto-pull from status transitions), not by typing into the recap; a division lead may add an optional weekly note | Consistent with M6B P6 |
| R5 | Cadence | **Weekly, ISO week (Mon–Sun), WIB.** Recap opens automatically Monday 00:00 WIB and locks after week close | Aligns with M8-OA-2 (Ads weekly), M10-OA-4 (weekly sessions) |

Inherited: money is IDR integer minor units with byte-exact BI formatting (frozen invariant); every field change / confirm / close is written to the immutable audit log; all timestamps `WIB_OFFSET_HOURS=7`; status changes only via `sm_transition`.

---

## 3. The single-source-of-truth risk — and the guardrail

Read R1 and R3 together and there is a hole. The recap displays GMV every week, and Module 6B §5 Rule 11 already says the monthly manual GMV per channel is *"the one manually-entered number every other calculation depends on."* If the weekly recap let the AM type an authoritative GMV too, we would have **two** manually-entered GMV figures for the same client and period — and they would drift, silently, with no rule saying which one the Health Score (Module 13) and the client report believe.

**Guardrail (Rule 8).** The weekly recap has exactly one class of GMV, and it is **execution-sourced and interim**:

- The recap's `GMV Eksekusi (interim)` is the **sum of the sources that already own GMV** — GMV from Ads (Module 8), GMV from Live (Module 10), and affiliate-link Attributed GMV (Module 9) — accumulated for the week. It is **read-only**, labelled *interim*, and explicitly **not** the official channel GMV.
- The **authoritative monthly GMV stays exactly where Module 6B put it**: manual entry by the AM at period close, within the 5-day integrity window, locked once the period is `Ditutup`. The recap never writes to it.
- Where the recap needs a manual number the system does not own (e.g. organic video views on a channel with no tracked link), that field is entered **with a mandatory source attachment + capture date**, and is flagged as manual — never blended silently into an auto figure (the M6B PE-3 / PA-3 discipline, applied here).

So the recap can show "GMV is trending up this week" without ever becoming a competing ledger. The number that is graded is still the one the measured party enters once a month, under Module 6B's window and lock.

---

## 4. Rules

1. **One recap per client per ISO week.** The system auto-generates a `Rekap Hasil Mingguan` (`WRR-…`) for **every active client** at 00:00 WIB every Monday. "Active" = a client with at least one non-terminal Service (any path). Dormant clients get none.
2. **The recap is client-level and cross-division (R2).** It consolidates Creative, Ads, KOL, and Live Stream for that client for that week, regardless of whether any Service is plan-gated. A client with only Direct-path / `Tanpa Plan` services still gets a full weekly recap — this is the record those services otherwise lack.
3. **Production counts are auto-pulled, read-only.** For the ISO week:
   - **Creative (Module 7):** count of Assets reaching `[Approved]` in the week, broken down by Asset Type — the headline being **# video**. Source: Daily Output → Approved-Asset count (M7 §8 Rule 2).
   - **KOL (Module 9):** count of Creator Bookings reaching `[QC Passed]` in the week — the **# creator** figure (M9's confirmed lead metric, §9 Rule 1 / M9-OA-*).
   - **Live Stream (Module 10):** count of Sessions reaching `[Completed]`/`[Reconciled]` in the week — the **# live** figure (M10 §6.3).
   - **Ads (Module 8):** count of active Ad Campaigns with a Metric Entry logged in the week, plus optimization actions (M8 `OPT-`).
   An AM cannot type these counts. They may file a `Sengketa Angka` note against any auto figure (Rule 7), which routes to SPV — the same escape hatch as M6B PE-6.
4. **Consolidated metrics come from the owning module first, manual only where nothing owns them (R3).** Per the ownership matrix (§8):
   - **GMV** → `GMV Eksekusi (interim)`, auto, per §3.
   - **ROAS** → auto from Ads (`GMV from Ads ÷ Total Spend`, M8 §5 Rule 3). Displayed as the Ads-channel ROAS; a blended whole-client ROAS is **not** invented (there is no agreed denominator across organic + live + paid — see Open Assumption RM-3).
   - **CTR / CVR** → auto from Ads Metric Entries where the platform provided them (M8 §9.4, "optional / where platform provides"); otherwise `—`. Cross-division CTR/CVR is **not** modelled — manual entry with source, or `—`.
   - **Total view** → auto sum of Live Stream viewers (M10) + any Ads impressions/views the platform reported; **organic video views are not system-owned** and are a manual field (with source) or `—`. The recap never fabricates a view count.
5. **Auto metrics are UPDATE-blocked for the AM at the DB level** (belt-and-braces with RLS — TS predicate and RLS must not diverge, frozen invariant), exactly as M6B PE-3 `otomatis` rows. Only manual fields (§4 fallbacks) and the narrative (RM-D) are AM-writable.
6. **The recap rolls up into the monthly Plan, it does not replace it (R1).** For a client with an `Aktif` Plan period (Full-Management M6B or Plan Satuan M6C), each week's recap is linked to that period. At period close, the period's weekly recaps supply Module 6B **PE-3** (auto metrics) and **PE-8** (execution-vs-plan) — they are the weekly evidence behind the monthly numbers. The recap **never** writes PE-1 (manual GMV). For a client with **no** Plan, the recap stands alone: it is that client's only periodic results record, and it is not blocked by the absence of a Plan.
7. **`Sengketa Angka` on an auto figure** routes to SPV and is logged; it never blocks the recap close and never mutates the auto figure in place (M6B PE-6 pattern).
8. **Confirm is a real step, not a date.** Closing a recap (`Terbuka` → `Ditutup`) requires: every auto figure present or explicitly `—`, every manual fallback either filled-with-source or explicitly marked "tidak tersedia", and the RM-D narrative (RM-D1 + RM-D3) completed. Force-close on overrun sets an incomplete flag, deliberately visible in reports.
9. **The recap is internal.** It is not a client-facing surface — client-facing results remain the external `mea-client-reporting` embed (Module 15 / Phase 0 OA-11). What the client sees is prepared from RM-D5 ("bahan untuk klien") and, monthly, from Module 6B PF-8. Nothing in this module is exposed through the Client Portal's allow-list (Module 15 §6.1).
10. **Immutable audit log** on every field change, manual entry, `Sengketa Angka`, confirm, and close (actor + WIB timestamp + before/after). No UPDATE/DELETE path on a closed recap; a post-close correction is an audit-logged amendment, visible on the recap view.
11. **No new grade.** The recap introduces **no** new score. It is a consolidation and hand-off layer; the graded numbers stay in Module 13 (Health) and Module 14 (Performance), which continue to read from the same execution-module and Plan sources they already read (this module adds no input to either).

---

## 5. Form structure

Legend: **W** = wajib · **O** = opsional · **A** = auto/read-only

### SECTION RM-A — Header & Konteks Minggu
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| RM-A1 | ID Rekap & Minggu | `WRR-…`, nomor minggu ISO + rentang tanggal (Sen–Min), zona WIB | Auto | A |
| RM-A2 | Klien | `CLI-…`, nama klien, AM/CRO pemilik | Auto | A |
| RM-A3 | Plan Terkait | `PLAN-…` periode `Aktif` yang mencakup minggu ini — atau `Tanpa Plan` (klien Direct/Satuan tanpa Plan) | Auto | A |
| RM-A4 | Status Rekap | `Terjadwal` / `Terbuka` / `Ditutup` / `Ditutup Otomatis` | Auto | A |
| RM-A5 | Service Aktif Minggu Ini | Daftar `SVC-…` yang punya Brief berjalan minggu ini + divisi tujuannya | Auto | A |
| RM-A6 | Catatan Pembuka | Fokus minggu ini menurut AM (mis. "dorong konten hero SKU, iklan ditahan sampai listing beres") | Long text | W |

### SECTION RM-B — Produksi per Divisi (auto, read-only)
One row per division touched this week. This is the *"berapa video / berapa live / berapa creator"* table.

| ID | Divisi | Isi baris | Sumber | Req |
|---|---|---|---|---|
| RM-B1 | **Creative** | Jumlah Asset `[Approved]` minggu ini, dipecah per jenis (Video / Gambar / Desain / SKU Setup / Copy). Headline: **# video** | M7 Daily Output | A |
| RM-B2 | **KOL** | Jumlah Booking `[QC Passed]` minggu ini = **# creator**; jumlah konten ter-submit; link Creator List terbaru | M9 | A |
| RM-B3 | **Live Stream** | Jumlah Session `[Completed]`/`[Reconciled]` minggu ini = **# live**; total durasi (jam) | M10 | A |
| RM-B4 | **Ads** | Jumlah Ad Campaign `[Active]` dengan Metric Entry minggu ini; jumlah aksi optimasi (`OPT-`) minggu ini | M8 | A |
| RM-B5 | Brief bergerak minggu ini | Ringkas per divisi: `[Submitted]` / `[Approved]` / `[Revision Requested]` (jumlah) + Brief yang `[Blocked]` | M6 §6 / M11 | A |
| RM-B6 | Sengketa Angka | Bantahan AM atas salah satu angka di RM-B + alasan → notifikasi SPV | Text | O |

### SECTION RM-C — Metrik Hasil Konsolidasi
Per §4 / §3. Each metric shows its `Sumber` = `otomatis` (owning module) or `manual` (fallback) or `—` (not available).

| ID | Label | Content | Sumber | Req |
|---|---|---|---|---|
| RM-C1 | GMV Eksekusi (interim) | Σ GMV from Ads (M8) + GMV from Live (M10) + Attributed GMV affiliate (M9), akumulasi minggu ini. **Interim, bukan GMV resmi** (§3) | Otomatis | A |
| RM-C2 | ROAS (Ads) | `GMV from Ads ÷ Total Spend` (M8) | Otomatis | A |
| RM-C3 | Total View | Σ viewers Live Stream (M10) + view/impressions yang dilaporkan platform Ads. View video organik: **manual + sumber**, atau `—` | Otomatis + manual fallback | W (isi atau `—`) |
| RM-C4 | CTR | Dari Metric Entry Ads bila platform menyediakan (M8); lainnya manual + sumber, atau `—` | Otomatis + manual fallback | W (isi atau `—`) |
| RM-C5 | CVR / CR | Dari Metric Entry Ads bila platform menyediakan (M8); lainnya manual + sumber, atau `—` | Otomatis + manual fallback | W (isi atau `—`) |
| RM-C6 | Ad Spend | Total Spend minggu ini (M8) | Otomatis | A |
| RM-C7 | Sumber & Tanggal (manual) | Untuk tiap angka `manual` di RM-C: lampiran export/screenshot + tanggal ambil data | File + date | W (kondisional) |
| RM-C8 | Delta vs Minggu Lalu | Auto: arah & besaran tiap metrik vs rekap minggu sebelumnya (klien yang sama) | Auto | A |

### SECTION RM-D — Narasi, Blocker & Hand-off
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| RM-D1 | Yang Bergerak | Apa yang jalan minggu ini + angka pendukung (mis. "ROAS naik 4,1→4,6 setelah restruktur kampanye") | Long text | W |
| RM-D2 | Yang Tertahan | Baris/Brief `[Blocked]` atau di bawah ekspektasi + akar sebabnya | Long text | W (bila ada blocker) |
| RM-D3 | Fokus Minggu Depan | Apa yang harus dikejar/diubah minggu berikutnya | Long text | W |
| RM-D4 | Keluhan Terkait | `CPL-…` klien ini yang aktif minggu ini (auto) + status | Auto | A |
| RM-D5 | Bahan untuk Klien | Poin yang akan disampaikan ke klien di check-in mingguan | Long text | O |
| RM-D6 | Catatan Divisi | Komentar opsional lead divisi (read-only untuk AM, tak bisa dihapus) — realisasi "divisi lapor ke Account" (Phase 0) tanpa entry ganda | Thread | O |

### SECTION RM-E — Rollup ke Plan (auto, read-only)
| ID | Content |
|---|---|
| RM-E1 | Kontribusi minggu ini ke periode Plan `Aktif` (RM-A3): akumulasi produksi & metrik minggu-ke-minggu dalam periode berjalan |
| RM-E2 | Posisi vs kuota/target periode (M6B P-B / P-C): % produksi tercapai sejauh periode berjalan (indikatif — angka resmi tetap di penutupan periode) |
| RM-E3 | Untuk klien `Tanpa Plan`: penanda bahwa rekap ini berdiri sendiri (tidak ada periode Plan yang menampungnya) |

### SECTION RM-F — Konfirmasi & Jejak
| ID | Content | Req |
|---|---|---|
| RM-F1 | Konfirmasi mingguan oleh AM/CRO: `Terbuka` → `Ditutup` (syarat kelengkapan Rule 8) | W |
| RM-F2 | Penutupan otomatis oleh sistem (`Ditutup Otomatis`) bila tidak dikonfirmasi dalam jendela + tanda tidak lengkap | A |
| RM-F3 | Riwayat perubahan lengkap (aktor + waktu WIB + before/after) | A |

---

## 6. Flow

1. **Monday 00:00 WIB** — the scheduled job creates one `WRR-…` per active client, `Terjadwal` → `Terbuka`, and links it to the client's `Aktif` Plan period if one exists (else `Tanpa Plan`). Auto figures begin accumulating from the execution modules through the week.
2. **During the week** — the AM/CRO can open the recap at any time to see live production counts and metrics. Auto figures are read-only. The AM fills RM-A6 and, where a metric is manual (RM-C fallbacks), enters the number with a source attachment, or marks it `—`.
3. **End of week** — the AM/CRO writes the RM-D narrative (what moved, blockers, next-week focus, client talking points), files any `Sengketa Angka` on disputed auto figures, then confirms: `Terbuka` → `Ditutup`. Close is transactional per Rule 8. *Error path:* not confirmed within the window → `Ditutup Otomatis`, incomplete fields flagged.
4. **Rollup** — a closed recap feeds the linked Plan period's PE-3/PE-8 (M6B). At **period close**, the AM sees the weeks' recaps as the evidence behind the monthly auto metrics; the AM still enters the authoritative monthly GMV manually per M6B Rule 11 — the recap does not do it for them.
5. **No-Plan clients** — the recap stands alone; there is no monthly Plan close to roll into, so the weekly recap chain *is* the periodic results record for that client. Module 13/14 continue to read their own inputs unchanged.

---

## 7. Example — Alpha Digital, minggu 3

**Context.** Alpha Digital (AM Sinta), Full Store Management, Plan periode 1 `Aktif` (12 Aug–11 Sep). ISO week 3 of the period = 26 Aug–1 Sep. The client also bought a Direct-path "Single KOL Booking" add-on with no Plan of its own — but because the recap is client-level (Rule 2), both show up in one recap.

**Monday 26 Aug 00:00 WIB.** System opens `WRR-202608-0047` for Alpha Digital, linked to `PLAN-2026-00xx` periode 1.

**By Sunday, auto figures (RM-B / RM-C):**
- Creative: 4 videos `[Approved]` this week (of the periode's 15-video row), 2 SKU Setups.
- KOL: 6 creators `[QC Passed]`.
- Live Stream: 2 lives `[Reconciled]`, 5,5 jam total.
- Ads: 3 Ad Campaigns with Metric Entries, 4 optimization actions.
- GMV Eksekusi (interim): Rp 41.000.000 (Ads Rp 28jt + Live Rp 11jt + affiliate Rp 2jt) — labelled interim.
- ROAS (Ads): 4,6. Ad Spend Rp 6,1jt. CTR 1,8% / CVR 3,1% (from TikTok Shop Metric Entry). Total View: 92.000 (Live viewers 20rb + Ads-reported views 72rb); organic video views for the 4 Creative videos → `—` (no tracked link).

**Sinta's narrative (RM-D):** RM-D1 "ROAS bertahan 4,6, 2 live minggu ini nyumbang Rp 11jt"; RM-D2 "1 Brief Creative `[Blocked]` nunggu foto produk dari klien"; RM-D3 "kejar sisa 11 video + follow up foto produk"; RM-D5 talking points for the Tuesday client call.

**Sinta confirms** `Terbuka` → `Ditutup` Sunday evening. The recap feeds periode 1's PE-3 (this is week 3 of 4). At period close on 11 Sep, Sinta still types the official monthly GMV per channel in M6B P-E — the four weekly recaps are the evidence beside it, not a substitute for it.

**Counter-case.** Had Alpha Digital been a `Tanpa Plan` KOL-only client, the same `WRR-…` would still open every Monday and be the *only* periodic results record for that client — closing the gap that Direct/`Tanpa Plan` services otherwise have no results trail.

---

## 8. System Requirements

**Entities.** `WRR-YYYYMM-NNNN` (weekly recap; register `WRR` in `entity_prefix` and `packages/core/src/ident.ts::PREFIXES` — both, per M6A §7). Children:
- `WRR_DIVISI` — one row per division touched (RM-B), all figures read-only/auto.
- `WRR_METRIK` — one row per consolidated metric (RM-C), columns `nilai`, `sumber` ∈ `otomatis` / `manual` / `tidak_tersedia`, `file_bukti`, `tanggal_ambil`, `nilai_minggu_lalu` (for RM-C8 delta). DB check: `file_bukti` + `tanggal_ambil` NOT NULL when `sumber = 'manual'`.
- `WRR_CATATAN` — the RM-D narrative fields + `WRR_CATATAN_DIVISI` thread (RM-D6), append-only.

**Relations.** `CLI` 1:N `WRR` (one per client per ISO week; partial unique index on `(client_id, iso_year, iso_week)`). `WRR` N:1 `PLAN` (nullable — null for no-Plan clients). `WRR` reads (never writes) M7 Assets, M8 Ad Campaigns / Metric Entries / Optimization Logs, M9 Bookings, M10 Sessions, M6 Briefs, M6 Complaints — all by client + week window. **The recap owns no execution data**; it is an aggregation-and-narrative layer over data that already exists (the Module 13 discipline: introduces no new raw metric input).

**Metric ownership (frozen — this module invents none of it):**

| Metric (RM-C) | Owning module | Field / formula | Fallback when absent |
|---|---|---|---|
| GMV (interim) | M8 + M10 + M9 | Σ GMV from Ads + GMV from Live + affiliate Attributed GMV | n/a (auto only) |
| ROAS (Ads) | M8 | GMV from Ads ÷ Total Spend | `—` |
| CTR / CVR | M8 | Metric Entry, where platform provides | manual + source, else `—` |
| Total view | M10 (+ M8 reported) | Σ viewers (+ Ads-reported views) | organic video views = manual + source, else `—` |
| Ad Spend | M8 | Σ Metric Entries | n/a (auto only) |
| # video | M7 | count `[Approved]` Assets, type Video, in week | 0 |
| # creator | M9 | count Bookings `[QC Passed]` in week | 0 |
| # live | M10 | count Sessions `[Completed]`/`[Reconciled]` in week | 0 |

CPL and impressions remain unmodelled system-wide (not introduced here) — see Open Assumption RM-4.

**State machine (machine #18 — weekly recap).** `Terjadwal` → `Terbuka` (auto, Monday 00:00 WIB) → `Ditutup` (AM confirm, Rule 8) | `Ditutup Otomatis` (system force-close). Terminal: `Ditutup`, `Ditutup Otomatis`. All transitions via `sm_transition` only. Auto figures continue to accrue while `Terbuka`; on either terminal state they are frozen as-of close. See `docs/STATE_MACHINES.md` §15.

**Scheduled jobs.** (a) Monday 00:00 WIB — open the week's recap per active client, and force-close the prior week's recaps still `Terbuka` (→ `Ditutup Otomatis`, incomplete flag); (b) week-close + N days (Open Assumption RM-5) — emit `rekap_mingguan_belum_dikonfirmasi`. Jobs idempotent, WIB.

**Notification catalog — amendment (v3).** Current catalog is v2 = 28 events (base 15 + 4 Strategi + 6 Plan + 3 Gate; see M6B §8). This module adds **3 events → catalog v3 = 31**. One migration.

| Event | Fires when | Recipients |
|---|---|---|
| `rekap_mingguan_terbuka` | Weekly recap opens (Monday job) | AM/CRO owning the client |
| `rekap_mingguan_belum_dikonfirmasi` | Not confirmed N days after week close | AM/CRO + SPV |
| `rekap_sengketa_angka` | AM files `Sengketa Angka` on an auto figure | SPV |

(The existing `== 15` / v2 catalog invariant test must be re-baselined to 31 with the same sign-off still pending from M6B PA-8 — see Open Assumption RM-6.)

**Permissions.**
| Role | Read | Write |
|---|---|---|
| AM/CRO (assigned) | own clients, all weeks | RM-A6, RM-C manual fallbacks, RM-D narrative, `Sengketa Angka`, confirm/close |
| SPV / Head of Account | all | override; resolve `Sengketa Angka` |
| Division lead | recaps of clients their division touched | RM-D6 division note only |
| OD / Direksi | all | none |
| Client | **none** (internal module — Rule 9) | none |

**Field-level notes.**
- Auto figures in `WRR_DIVISI` / `WRR_METRIK` are `UPDATE`-blocked at the DB level for JWT (AM) roles, mirrored in RLS `WITH CHECK` — TS predicate and RLS must not diverge (frozen invariant, same shape as M6B `plan_actual`).
- Close is a transaction: all auto figures resolved + all manual fallbacks filled-or-`tidak_tersedia` + RM-D1/RM-D3 present, or nothing. Partial close is not a state.
- The ISO-week key is stored explicitly (`iso_year`, `iso_week`) — never derived at read time — so a recap's identity is stable across time-zone/date arithmetic. Week boundaries are WIB (Mon 00:00 → Sun 23:59:59 WIB).
- Money: IDR integer minor units, byte-exact BI formatting (frozen invariant). Division-by-zero in ROAS/CTR/CVR renders `—`, never an error (house rule #7).

**Non-functional.** The recap must render for a client with ~4 divisions × dozens of Briefs without a per-read recompute storm — auto figures are aggregated by the Monday job and refreshed on demand, not recomputed on every page load. Desktop-first for confirming; mobile read-only for the current week.

---

## 9. Open Assumptions

| ID | Assumption | Owner |
|---|---|---|
| RM-1 | Cadence is the ISO week (Mon–Sun) in WIB. If the agency's operational week or the client check-in rhythm differs, this is the one knob to change | Yohan / Nerissa |
| RM-2 | "Active client" (Rule 1) = a client with ≥1 non-terminal Service. If clients in a payment-hold or paused state should be excluded, that filter belongs here | Yohan |
| RM-3 | No **blended whole-client ROAS** is computed — only the Ads-channel ROAS is shown — because there is no agreed denominator spanning organic + live + paid spend. If management wants a single blended ROAS, the denominator must be defined first (which spends count) | Yohan / SPV Ads |
| RM-4 | CPL and impressions stay unmodelled (they exist nowhere in CDPS today). If the weekly recap must show CPL, the metric and its source have to be added in the owning module (M8) first — it is deliberately **not** invented here (R3) | Hans / SPV Ads |
| RM-5 | Force-close / `belum dikonfirmasi` warning window = N days after week close. Starting value to tune from real behaviour (M6B used 5 days for monthly GMV — weekly should likely be shorter, 1–2 days) | Yulianti |
| RM-6 | Carried from 6A/6B/6C: the notification-catalog invariant test asserts a literal count; it is now v3 = 31 events and still needs the sign-off that was pending at M6B PA-8 before any of these modules ship notifications | Hans |
| RM-7 | Organic video "views" have no tracked source in CDPS today, so RM-C3's organic component is manual-with-source or `—`. If a platform export becomes routinely available, it can graduate from manual to auto without changing the recap's shape | Hans / SPV Creative |
| RM-8 | Division note (RM-D6) is optional. If management wants divisions to *owe* a weekly note (the literal Phase 0 "divisions send weekly reports" step), it becomes a mandatory field with its own reminder — a scope choice, not a code one | Yohan |

---

## 10. Success Metrics

**Activation event.** First weekly recap **closed by an AM** (not `Ditutup Otomatis`) with complete auto figures and a written narrative — not "recap created" (creation is automatic and therefore meaningless as a signal).

**North star.** % of active clients whose **current** week recap is closed by its AM with a complete narrative. Target ≥ 90%. This catches the two ways the recap dies: never looked at (auto-closed empty), or looked at but never narrated (numbers with no story).

| Metric | Why | Target |
|---|---|---|
| % recaps closed by AM vs `Ditutup Otomatis` | Auto-close = the weekly review was skipped | ≥ 85% AM-closed |
| % **no-Plan** clients with a closed weekly recap | The specific gap R2 exists to close — proves Direct/`Tanpa Plan` clients now have a results trail | ≥ 90% |
| Median hours from week close → recap confirmed | A weekly cadence only works if it is timely | ≤ 48 h |
| % recaps with a substantive RM-D narrative (not just "aman") | The recap is worthless as pure number-echo; the narrative is the point | reviewed, not scored |
| `Sengketa Angka` rate per division | High rate = an execution module's auto figure is mistrusted → fix the source, not the recap | tracked per division |

**Anti-vanity guard.** Do not headline "recaps created" or "recaps closed on time" — the first is automatic, the second rises when an AM rubber-stamps. Pair the close rate with the no-Plan coverage rate and the narrative-substance review, which cannot be moved by clicking confirm.
