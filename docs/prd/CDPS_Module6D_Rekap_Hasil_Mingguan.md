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
8. **Integrasi ke Client Health Report (M13) — the summary surface**
9. System Requirements
10. Open Assumptions
11. Success Metrics

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

1. **One recap per client per ISO week.** The system auto-generates a `Rekap Hasil Mingguan` (`WRR-…`) for **every active client** at 00:00 WIB every Monday. **"Active" = a client with at least one non-terminal Service (any path), *excluding* clients whose services are all in a payment-hold / paused state** (owner decision 2026-08-13, RM-2: *"klien aktif ≥1 service, kalau hold dikecualikan"*). A held/paused client is not being executed on this week, so a recap for it would only ever auto-close empty and distort the coverage metric. Dormant and fully-held clients get none; the exclusion is a `WHERE` filter on the Monday job (D-03), pinned to the Service machine's hold/paused states.
2. **The recap is client-level and cross-division (R2).** It consolidates Creative, Ads, KOL, and Live Stream for that client for that week, regardless of whether any Service is plan-gated. A client with only Direct-path / `Tanpa Plan` services still gets a full weekly recap — this is the record those services otherwise lack.
3. **Production counts are auto-pulled, read-only.** For the ISO week:
   - **Creative (Module 7):** count of Assets reaching `[Approved]` in the week, broken down by Asset Type — the headline being **# video**. Source: Daily Output → Approved-Asset count (M7 §8 Rule 2).
   - **KOL (Module 9):** count of Creator Bookings reaching `[QC Passed]` in the week — the **# creator** figure (M9's confirmed lead metric, §9 Rule 1 / M9-OA-*).
   - **Live Stream (Module 10):** count of Sessions reaching `[Completed]`/`[Reconciled]` in the week — the **# live** figure (M10 §6.3).
   - **Ads (Module 8):** count of active Ad Campaigns with a Metric Entry logged in the week, plus optimization actions (M8 `OPT-`).
   An AM cannot type these counts. They may file a `Sengketa Angka` note against any auto figure (Rule 7), which routes to SPV — the same escape hatch as M6B PE-6.
4. **Consolidated metrics come from the owning module first, manual only where nothing owns them (R3).** Per the ownership matrix (§9):
   - **GMV** → `GMV Eksekusi (interim)`, auto, per §3.
   - **ROAS** → auto from Ads (`GMV from Ads ÷ Total Spend`, M8 §5 Rule 3). Displayed as the Ads-channel ROAS; a blended whole-client ROAS is **not** invented (there is no agreed denominator across organic + live + paid — see Open Assumption RM-3).
   - **CTR / CVR** → auto from Ads Metric Entries where the platform provided them (M8 §9.4, "optional / where platform provides"); otherwise `—`. Cross-division CTR/CVR is **not** modelled — manual entry with source, or `—`.
   - **Total view** → auto sum of Live Stream viewers (M10) + any Ads impressions/views the platform reported; **organic video views are not system-owned** and are a manual field (with source) or `—`. The recap never fabricates a view count.
5. **Auto metrics are UPDATE-blocked for the AM at the DB level** (belt-and-braces with RLS — TS predicate and RLS must not diverge, frozen invariant), exactly as M6B PE-3 `otomatis` rows. Only manual fields (§4 fallbacks) and the narrative (RM-D) are AM-writable.
6. **The recap rolls up into the monthly Plan, it does not replace it (R1).** For a client with an `Aktif` Plan period (Full-Management M6B or Plan Satuan M6C), each week's recap is linked to that period. At period close, the period's weekly recaps supply Module 6B **PE-3** (auto metrics) and **PE-8** (execution-vs-plan) — they are the weekly evidence behind the monthly numbers. The recap **never** writes PE-1 (manual GMV). For a client with **no** Plan, the recap stands alone: it is that client's only periodic results record, and it is not blocked by the absence of a Plan.
7. **`Sengketa Angka` on an auto figure** routes to SPV and is logged; it never blocks the recap close and never mutates the auto figure in place (M6B PE-6 pattern).
8. **Confirm is a real step, not a date.** Closing a recap (`Terbuka` → `Ditutup`) requires: every auto figure present or explicitly `—`, every manual fallback either filled-with-source or explicitly marked "tidak tersedia", and the RM-D narrative (RM-D1 + RM-D3) completed. Force-close on overrun sets an incomplete flag, deliberately visible in reports. The **force-close window is N = 2 working days** after the week closes (owner decision 2026-08-13, RM-5 — owner-tunable, §10.1-A). An auto-closed recap is **not the end of the road**: the **Head of Account** (the AM's superior, *not* the AM) may **reopen** it (`Ditutup Otomatis → Terbuka`) so the AM can complete it — but reopening leaves `pernah_ditutup_otomatis = true` permanently, so the non-performance is still on record (RM-5, §10.1-A).
   - **Division weekly note is now mandatory (RM-8, owner 2026-08-13: *"divisi wajib buat report mingguan"*).** Each division that touched the client this week **owes** a weekly note (RM-D6). A division that has not filed by close is flagged and fires `catatan_divisi_belum_diisi` (to the division lead + AM). **This obligation is on the division, not on the AM** — a missing division note does **not** block the AM's `Terbuka → Ditutup` (an AM cannot type another team's note), it is tracked as the division's own discipline signal and feeds that division's M14 score (RM-9a). The AM close requirements above are unchanged.
9. **The recap is internal.** It is not a client-facing surface — client-facing results remain the external `mea-client-reporting` embed (Module 15 / Phase 0 OA-11). What the client sees is prepared from RM-D5 ("bahan untuk klien") and, monthly, from Module 6B PF-8. Nothing in this module is exposed through the Client Portal's allow-list (Module 15 §6.1).
10. **Immutable audit log** on every field change, manual entry, `Sengketa Angka`, confirm, and close (actor + WIB timestamp + before/after). No UPDATE/DELETE path on a closed recap; a post-close correction is an audit-logged amendment, visible on the recap view.
11. **No new grade, but it *is* surfaced on the Health Report.** The recap introduces **no** new scored component: Module 13's seven components and their confirmed weights (M13 Rule 3) are untouched, and Module 14 is untouched. What the recap does is **feed the Client Health Report view as its progress-and-results summary** — the health page is where "semua report, progress, ada komplain atau tidak, dan hasil" come together, and the weekly recap is the progress/results half of that summary. Full contract in §8. The distinction is load-bearing: the recap changes **what the health page shows**, never **how the score is computed**.

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
| RM-C9 | Catatan Metrik Tambahan (teks) | **Teks-bebas untuk pencatatan** metrik yang belum dimodelkan (CPL, impressions, CPC/CPM, view organik, dsb) — owner 2026-08-13 (RM-4): *"tidak perlu dimodelkan, tapi bisa dibuat text-only untuk pencatatan."* **Bukan angka terhitung**, tak masuk delta/rollup/skor, tak pernah dibaca sebagai metrik — murni catatan agar AM bisa menuliskannya di satu tempat. Tidak menggantikan pemodelan (kalau kelak dimodelkan di M8/M7, ia berhenti jadi teks) | Long text | O |

### SECTION RM-D — Narasi, Blocker & Hand-off
| ID | Label | Content | Type | Req |
|---|---|---|---|---|
| RM-D1 | Yang Bergerak | Apa yang jalan minggu ini + angka pendukung (mis. "ROAS naik 4,1→4,6 setelah restruktur kampanye") | Long text | W |
| RM-D2 | Yang Tertahan | Baris/Brief `[Blocked]` atau di bawah ekspektasi + akar sebabnya | Long text | W (bila ada blocker) |
| RM-D3 | Fokus Minggu Depan | Apa yang harus dikejar/diubah minggu berikutnya | Long text | W |
| RM-D4 | Keluhan Terkait | `CPL-…` klien ini yang aktif minggu ini (auto) + status | Auto | A |
| RM-D5 | Bahan untuk Klien | Poin yang akan disampaikan ke klien di check-in mingguan | Long text | O |
| RM-D6 | Catatan Divisi | **Wajib** (owner 2026-08-13, RM-8): tiap divisi yang menyentuh klien minggu ini **berutang** satu catatan mingguan (read-only untuk AM, tak bisa dihapus) — realisasi literal "divisi lapor ke Account" (Phase 0) tanpa entry ganda. Divisi yang belum mengisi saat tutup → flag + event `catatan_divisi_belum_diisi`. **Tidak memblok tutup rekap milik AM** (kewajiban ada pada divisi, bukan AM); masuk skor disiplin divisi (M14, RM-9a) | Thread | **W** (per divisi terlibat) |

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

## 8. Integrasi ke Client Health Report (M13) — the summary surface

**Owner requirement (2026-08-12).** `/health` is the place where everything about a client comes together: *"summary dari semua report, progress, ada komplain atau tidak, dan hasil."* The weekly recap must connect there. This section is the contract.

### 8.1 What `/health` shows today vs what it must show

The implemented health view (`web-internal/src/app/(shell)/health/[clientId]`) currently renders **the score's arithmetic**: score + band, the 7-component breakdown (raw/capped/base weight/effective weight), the snapshot trend, and the ROAS toggle. That is faithful to M13 §5 — but it is *not yet* the summary the owner describes, and it is also short of **Phase 0 v2 Diagram 3**, which already specified the Client Health Dashboard as: Health Score, GMV Growth % MoM, Tasks Completion, Satisfaction, **Alerts (issue count)**, **per-platform Project Status (platform / service / progress / deadline)**, **Performance Metrics (ROAS, CPC, Conversion, CPM)**, and Upcoming Milestones. The progress/results/complaint halves of that dashboard were never built.

The weekly recap is what makes them buildable, because it is the layer that already consolidates production and metrics per client per week.

### 8.2 The four summary blocks the health view gains

Added to the client health view, **read-only, below the existing score/band header** (the score stays the headline — this is summary, not replacement):

| Block | Content | Source |
|---|---|---|
| **H-1 Hasil & Progress Mingguan** | Latest **closed** week's recap: production per division (**# video** Creative · **# live** Live Stream · **# creator** KOL · # campaign/optimasi Ads) + consolidated metrics (total view, GMV eksekusi interim, CTR, CVR, ROAS, spend) + delta vs the week before, and the AM/CRO narrative headline (RM-D1 "Yang Bergerak" / RM-D2 "Yang Tertahan") | M6D `WRR-` (this module) |
| **H-2 Status Laporan** | Recap freshness & discipline: is the current week's recap `Terbuka` / `Ditutup` / `Ditutup Otomatis`; how many of the last 4 weeks were AM-closed vs auto-closed; count of open `Sengketa Angka`. **Displayed, not scored** | M6D `WRR-` status |
| **H-3 Komplain** | Open/active complaints for this client with severity + status — answering "ada komplain atau tidak" directly on the page, instead of only as a −5/−15/−30 number inside the Complaints component | M6 `CPL-` (`listClientComplaints`) |
| **H-4 Kesiapan Klien (Interview)** | *Optional context block.* Latest interview verdict (`siap` / `bersyarat` / `tidak_siap`) + `prasyarat_status`, as onboarding-readiness context for a low score. **Advisory only** — the verdict never gates anything (Interview v5 decision) and never enters the score | Interview module (`getInterviewVerdict` / `listInterviewsByClient`) |

### 8.3 Rules for the integration (the part that keeps it honest)

1. **The score is untouched.** No component is added, no weight is redistributed, no source is swapped. M13 Rules 2–5 and the confirmed weight table stand exactly as they are. Whether recap discipline should ever *become* a scored component is an owner decision that requires re-weighting — logged as Open Assumption RM-9, deliberately **not** taken here.
2. **Two GMV figures appear on one page, so they must be labelled unambiguously.** The health score's GMV Growth reads **client GMV from Module 4** (the official monthly figure, ultimately the AM's manual entry under M6B Rule 11). The recap's figure is **`GMV Eksekusi (interim)`** — execution-sourced (Ads + Live + affiliate), weekly, read-only. The view renders them with those exact labels and never sums them together. This is the §3 single-source guardrail carried onto the display layer, where it is easiest to violate.
3. **Same for ROAS.** H-1 shows the **Ads-channel ROAS** (M8). The score's **ROAS Attainment** is `Current Period ROAS ÷ Target ROAS`, capped, and subject to the per-client ROAS toggle (M13 Rule 13). Different numbers, different purposes, both labelled.
4. **Drill-down, not duplication.** Each summary block links to the owning surface (weekly recap detail, complaint record, interview record, Plan period) rather than re-implementing it. The health view stores nothing — it reads, exactly as M13 §1 intends ("purely an aggregation and scoring layer — introduces no new raw data").
5. **Permissions are the intersection, degraded per block.** The health view keeps its own gate (`canView`: assigned AM / Account lead / OD / Director). Each block additionally respects its own source's scope, and a block the actor may not read **renders as absent, never as an error that blanks the page** — the failure mode already learned in this codebase (a joined read that 404s a whole page, O52). In particular H-4 must respect the interview verdict's narrower scope (Account + sales closing + Sales lead) and simply not render for actors outside it.
6. **Nothing here is client-facing.** The recap is internal (Rule 9) and M13 itself is not client-facing (M13 Rule 11). Client-facing health remains **band-only** through Module 15's allow-list ("On Track" / "Needs Attention" / "Action Needed"), and none of H-1…H-4 is exposed there.
7. **The monthly snapshot stays immutable.** These blocks are a **live read** beside the snapshot, not part of it. A `CHR-` snapshot is never rewritten to embed recap data (M13 Rule 9); reopening an old period shows that period's recaps read from the recap chain, labelled with their own weeks.
8. **Portfolio view.** The `/health` landing page — today just a scan button plus a link to the client list — becomes the portfolio scan M13 Rule 12 / M15 Rule 11 already imply: one row per active client with band, month-over-month band-drop flag, **open-complaint count**, and **recap freshness** (last closed week). This is the one screen where management sees who needs attention, and recap freshness belongs on it because a client with no recap for three weeks is unmanaged whether or not the score has caught up yet.

### 8.4 Why this direction and not the alternative

The tempting alternative is to make the recap an eighth scored component ("did the AM keep the client's results updated?"). Rejected for now: it would require redistributing the confirmed weights, and — more importantly — it grades the **AM's form-filling**, not the **client's health**, which is a Module 14 (Team Performance) question wearing a Module 13 costume. Recap discipline as a *visible* signal (H-2) gets the management value without corrupting what the Health Score means. If the owner wants it scored, RM-9 is the door, and M14 is probably the better room.

---

## 9. System Requirements

**Entities.** `WRR-YYYYMM-NNNN` (weekly recap; register `WRR` in `entity_prefix` and `packages/core/src/ident.ts::PREFIXES` — both, per M6A §7). Own columns include `pernah_ditutup_otomatis` (boolean, default false; set true at force-close, **never** reset — the permanent non-performance signal the M14 discipline score reads, RM-5/RM-9). Children:
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

**State machine (machine #18 — weekly recap).** `Terjadwal` → `Terbuka` (auto, Monday 00:00 WIB) → `Ditutup` (AM confirm, Rule 8) | `Ditutup Otomatis` (system force-close) → (Head reopen) `Terbuka`. Terminal: only `Ditutup`; `Ditutup Otomatis` is **quasi-terminal** — a dead end for the AM, but the **Head of Account** may reopen it (owner decision 2026-08-13, RM-5). All transitions via `sm_transition` only. Auto figures continue to accrue while `Terbuka`; on close they are frozen as-of close, and thaw again if a Head reopens. Force-close sets **`pernah_ditutup_otomatis = true` permanently** — reopening never clears it (it rescues the *data*, not the AM's *record*); the M14 discipline score and H-2 count this flag, not the final status. See `docs/STATE_MACHINES.md` §15.

**Scheduled jobs.** (a) Monday 00:00 WIB — open the week's recap per active client (excluding held/paused, RM-2), and force-close the prior week's recaps still `Terbuka` (→ `Ditutup Otomatis`, incomplete flag); (b) week-close + **N = 2 working days** (RM-5, resolved 2026-08-13) — emit `rekap_mingguan_belum_dikonfirmasi`; (c) at close — for any division that owes a mandatory note (RM-8) and hasn't filed, emit `catatan_divisi_belum_diisi`. Jobs idempotent, WIB, using the shared `working_days_between` helper.

**Notification catalog — amendment (NEW version v7). ⚠️ Premise corrected 2026-08-13.** The SESI1 draft said "current = v2 = 28 → this adds 3 = v3 = 31" — that is **stale**. The catalog is now asserted against a **version registry** (O55, `notif_catalog_versions`), not a literal, and the live catalog in `packages/core/src/notification.ts` is already **v6 = 44 events** (v1=17, v2=14, v3=2, v4=1, v5=9, v6=1). M6D therefore registers a **new version v7** — **4 events → v7 = 48** (the 3 recap events + 1 for RM-8's mandatory division note). One migration, one `notif_catalog_versions` row.

| # | Event | Fires when | Recipients |
|---|---|---|---|
| 45 | `rekap_mingguan_terbuka` | Weekly recap opens (Monday job) | AM/CRO owning the client |
| 46 | `rekap_mingguan_belum_dikonfirmasi` | Not confirmed N (=2) working days after week close | AM/CRO + SPV |
| 47 | `rekap_sengketa_angka` | AM files `Sengketa Angka` on an auto figure | SPV |
| 48 | `catatan_divisi_belum_diisi` | A division owing a mandatory weekly note (RM-8) hasn't filed by close | Division lead + AM |

(The catalog-version invariant test — `registeredEventCount()` against the `notif_catalog_versions` rows — is re-baselined by **adding the v7 row (eventCount: 4)**, not by editing a literal. The **catalog sign-off** pending since M6B PA-8 is still the one gate before any of these modules ship notifications — the full v1→v6 enumeration for that sign-off is in `docs/handoff/HANDOFF_M6D_SESI2.md`. See Open Assumption RM-6 / §10.1-C.)

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

## 10. Open Assumptions

> **Owner answered 2026-08-13** (`DECISIONS.md`). **All of RM-1…RM-11 are now decided (✅).** The final three
> — the catalog sign-off (RM-6), the M14 discipline weights (RM-9a), and the metric-modelling go/no-go
> (RM-7/RM-11) — were **signed off/closed by the owner on 2026-08-13** (see the two 2026-08-13 rows in
> `DECISIONS.md`; detail in §10.1). No assumption is left silently guessed and none is left open.

| ID | Assumption (as raised at SESI1) | Owner | Status / Resolusi (2026-08-13) |
|---|---|---|---|
| RM-1 | Cadence is the ISO week (Mon–Sun) in WIB. If the agency's operational week or the client check-in rhythm differs, this is the one knob to change | Yohan / Nerissa | ✅ **Confirmed.** ISO week (Mon–Sun) WIB is correct; no change |
| RM-2 | "Active client" (Rule 1) = a client with ≥1 non-terminal Service. If clients in a payment-hold or paused state should be excluded, that filter belongs here | Yohan | ✅ **Decided: active = ≥1 non-terminal Service AND *exclude* payment-hold / paused clients.** Owner: *"definisi klien aktif ≥1 service, kalau hold dikecualikan."* Rule 1 amended below; the exclusion is a `WHERE` filter on the Monday job (D-03), pinned to the Service machine's hold/paused states |
| RM-3 | No **blended whole-client ROAS** is computed — only the Ads-channel ROAS is shown — because there is no agreed denominator spanning organic + live + paid spend | Yohan / SPV Ads | ✅ **Decided: no blend. ROAS is Ads-channel only.** Owner: *"roas hanya dari iklan."* RM-C2 stays `GMV from Ads ÷ Total Spend`; no blended-ROAS denominator is invented. Closes RM-3 permanently |
| RM-4 | CPL and impressions stay unmodelled (they exist nowhere in CDPS today) | Hans / SPV Ads | ✅ **Decided (2026-08-13): NOT modelled, but a text-only record field is added.** Owner: *"tidak perlu dimodelkan, tapi apa bisa dibuat text-only untuk pencatatan."* ⇒ new form field **RM-C9 "Catatan Metrik Tambahan (teks)"** — free text, never a computed metric, never in delta/rollup/score. CPL/impressions/CPC/CPM/organic views live there as notes until (if ever) modelled in M8/M7. §10.1-B explains "modelled" |
| RM-5 | Force-close / `belum dikonfirmasi` warning window = N days after week close | Yulianti | ✅ **Decided (2026-08-13): N = 2 hari kerja**, owner-tunable; **+ a Head can reopen an auto-closed recap** (`Ditutup Otomatis → Terbuka`), which rescues the data but leaves `pernah_ditutup_otomatis = true` permanently (the AM's non-performance stays on record, feeds M14). Worked example + reopen flow in §10.1-A |
| RM-6 | Notification-catalog sign-off, carried from M6B PA-8 | Hans | ✅ **Signed off 2026-08-13.** Owner: *"Iya ini benar."* The catalog **v7 = 48** (44 live v1–v6 + 4 M6D events) is approved, so the **M6B PA-8 gate is cleared** — modules may ship notifications; D-07 is unblocked. Registration is one `notif_catalog_versions` row (`eventCount: 4`), not a literal (O55). Premise history + full enumeration in §10.1-C |
| RM-7 | Organic video "views" have no tracked source in CDPS today, so RM-C3's organic component is manual-with-source or `—` | Hans / SPV Creative | ✅ **Decided 2026-08-13: not modelled now (default b).** Owner: *"tidak perlu bangun dulu, buat saja kolom dengan text only, saat ini belum dibutuhkan."* Organic views stay `—` in the metric column; the figure may be jotted in the text-only **RM-C9** field (same class as RM-4). Auto only if/when the source is built in the owning module (M7). §10.1-B |
| RM-8 | Division note (RM-D6) is optional | Yohan | ✅ **Decided: MANDATORY.** Owner: *"divisi wajib buat report mingguan."* RM-D6 becomes a required weekly note **owed by each division that touched the client this week**, with its own reminder (the literal Phase 0 "divisions send weekly reports" step). Rule 8 + form amended below; new advisory event `catatan_divisi_belum_diisi` (part of the v7 catalog, §10.1-C) |
| RM-9 | **Recap discipline is displayed (H-2), not scored.** | Yohan / Nerissa | ✅ **Decided: displayed AND scored.** Owner: *"disiplin perlu [dari] RM-8 dinilai dan ditampilkan."* Displayed stays H-2 (unchanged). **Scored** lands in **M14 Team Performance — NOT an eighth M13 component** (§8.4 guardrail holds: no re-weight of M13's confirmed weights, no grading AM form-filling inside a client-health number). Discipline measured = the RM-8 obligation: AM recap closed-on-time + divisions' mandatory weekly notes filed. Requires an M14 amendment that re-weights the confirmed AM KPI Profile (50/25/25) — flagged for M14 sign-off, see M14 amendment note + RM-9a below |
| RM-10 | H-4 (interview verdict on the health view) is assumed useful and **advisory only** | Yohan | ✅ **Decided: keep H-4.** Owner: *"verdict interview ditampilkan di halaman health."* H-4 stays, advisory-only (never gates), respecting the narrower `canReadVerdict` scope (§8.3 Rule 5). Closes RM-10 |
| RM-11 | Phase 0 Diagram 3 also lists **CPC / CPM** and **Upcoming Milestones** | Hans / SPV Ads | ✅ **Decided 2026-08-13: not modelled now (default b).** Owner: *"tidak perlu bangun dulu, buat saja kolom dengan text only, saat ini belum dibutuhkan."* Same class as RM-4/RM-7: CPC/CPM unmodelled system-wide (may be jotted in **RM-C9** text), milestones have no entity ⇒ out of H-1 scope until their sources are built in the owning module (M8). §10.1-B |

### RM-9a (✅ signed off 2026-08-13) — how discipline is scored in M14

RM-9's "score it" opened exactly one downstream question: **the M14 re-weight**, now settled. The AM KPI
Profile was confirmed at **50 / 25 / 25** (avg Client Health Score / Complaint Resolution Speed / Revision
Escalation Rate, M14 §6 #6). Adding a **Weekly-Recap Discipline** component means those three no longer sum
to 100. **Owner decision 2026-08-13** (*"jalankan Rekomendasi carve 10–15%… mis. 45 / 22.5 / 22.5 / 10, +
slice kepatuhan-catatan di profil tiap divisi"*): carve a **10%** Weekly-Recap Discipline slice
**proportionally** from the existing three → **45 / 22.5 / 22.5 / 10**, where Weekly-Recap Discipline = *% of
the AM's active clients whose current-week recap was AM-closed on time and never force-closed
(`pernah_ditutup_otomatis = false`)*. The **division** side of RM-8 (did the division file its mandatory
note) is a **5% Weekly-Note Compliance** slice, carved **proportionally** from each **division role's** M14
profile (Creative 28.5/23.75/23.75/19/**5**, Ads 23.75/28.5/23.75/19/**5**, KOL 28.5/23.75/19/23.75/**5**) —
not the AM's. Live-stream is a vendor, not an M14-scored role. The full amendment lives in **M14 §9** (with the
weight table); M6D only supplies the raw signal (recap close status + `pernah_ditutup_otomatis` flag +
division-note presence), it does not compute the grade. Tracked as **D-14**.

### 10.1 Clarifications requested by the owner (2026-08-13)

#### A. RM-5 — what the "force-close window" is, with an example

The recap opens automatically every Monday and the AM is meant to **confirm** it (`Terbuka → Ditutup`) after
the week ends. The **force-close window** is the grace period *after the week closes* during which the AM can
still confirm before the system gives up and stamps the recap `Ditutup Otomatis` (auto-closed, flagged
incomplete). It exists so an un-confirmed recap cannot sit `Terbuka` forever, silently, hiding that the weekly
review never happened.

Two clocks hang off the same window value **N**:
- a **reminder** at week-close + N days → event `rekap_mingguan_belum_dikonfirmasi` (to the AM + SPV);
- a **force-close** by the Monday job when the prior week's recap is still `Terbuka` past the window.

**Decided default: N = 2 hari kerja (working days), owner-tunable** — the same way M6B's monthly window was
set to 5 days and left adjustable. Working days (not calendar days) so a weekend or national holiday does not
burn the window; it reuses the same `working_days_between` helper the Kelola-Klien SLA already uses.

> **Worked example (N = 2).** ISO week 3 ends **Sunday 1 Sep 23:59 WIB**. Monday 2 Sep the next week's recap
> opens as normal. AM Sinta has until **end of Wednesday 4 Sep** (Mon + Tue = 2 working days) to confirm
> week 3's recap.
> - Confirms Tuesday 3 Sep → `Ditutup`, clean. ✅
> - Hasn't confirmed by Wednesday morning → reminder fires to Sinta + her SPV.
> - Still `Terbuka` at the next Monday job (8 Sep) → `Ditutup Otomatis`, flagged incomplete, and that
>   auto-close is what H-2 on the health page shows and what the RM-9 M14 discipline score counts against her.
>
> If 2 working days proves too tight (or too loose) in practice, changing N is a one-line config change, not a
> schema or code change — exactly the M6B precedent.

**Reopen after force-close (owner decision 2026-08-13).** An auto-closed recap is a dead end for the AM, but
**not** for her superior. The **Head of Account** — explicitly *not* the AM herself — may **reopen** a
`Ditutup Otomatis` recap (`Ditutup Otomatis → Terbuka`, with a mandatory reason logged) so the week's real
result is not lost to a missed deadline. The crucial part the owner asked for: **reopening rescues the data,
not the AM's record.** The recap carries a permanent flag `pernah_ditutup_otomatis` that is set at force-close
and **never** cleared — so even after the Head reopens it and Sinta completes and closes it properly, that week
still counts as a force-close against her in H-2 and in the M14 discipline score (RM-9/RM-9a). The Head cannot
launder a missed week into a clean one; they can only make sure the numbers survive.

> **Continuing the example.** Sinta's week-3 recap auto-closed on 8 Sep. On 9 Sep her Head reopens it (reason:
> *"data live minggu 3 penting untuk periode Plan"*). It goes back to `Terbuka`, auto figures thaw, Sinta fills
> the narrative and closes it 10 Sep → `Ditutup`. The recap is now complete **and** `pernah_ditutup_otomatis`
> is still `true`: the Plan rollup (RM-E) gets the real numbers, and Sinta's M14 discipline still records one
> force-closed week. Only the **Head** could do this; the AM has no reopen button.

#### B. RM-4 / RM-7 / RM-11 — what "perlu dimodelkan" (modelled) actually means, with an example

"Modelling a metric" in CDPS means giving it a **real, owned, recomputable source** so the number is
*auto-calculated and read-only* (house rule #4) — not typed by a human. A metric is "modelled" only when
**four** things exist:

1. a **column/entity** that stores its raw inputs (e.g. `MTR-` Metric Entry rows for Ads),
2. an **owning module** that writes those inputs as a side-effect of real work (Ads staff logging a Metric Entry),
3. a **formula** the system computes from them (`ROAS = GMV from Ads ÷ Total Spend`), and
4. a **recompute-from-log** guarantee (the number can always be rebuilt from the immutable rows — house rule #3/#4).

> **Example — ROAS *is* modelled, CPL is *not*.**
> ROAS is modelled: an Advertiser logs a weekly `MTR-` entry with Spend and GMV-from-Ads; the system computes
> ROAS and it is read-only; delete-and-recompute always reproduces it. **M6D just reads it.**
> **CPL (cost per lead)** is *not* modelled: nowhere in CDPS today stores "spend attributable to a lead" per
> week — there is no `MTR-`-like row for it, no module that writes it, no formula wired up. So for M6D to
> "show CPL" one of two things is true: (a) somebody **types** it every week (a manual number that can lie and
> isn't recomputable — banned by R3 / house rule #4), or (b) CPL is **first modelled in its owning module
> (M8)** — add the input to the Metric Entry, define `CPL = eligible spend ÷ leads`, make it read-only — and
> *then* M6D reads it like ROAS.
>
> So "perlu dimodelkan?" = *"do you want us to go build a real tracked source for this in M8/M7 first (a),
> or leave it as `—` until someone does (b)?"* The M6D default (R3) is **(b): leave it `—`, don't fake it.**
> The same reading applies to **impressions, CPC/CPM (RM-11), and organic video views (RM-7)** — all four are
> in the identical position: no owned source today, so either commission the source in the owning module or
> show `—`. M6D deliberately builds **none** of these auto-pipelines itself.

**Owner decision 2026-08-13 (RM-4): don't model them — but give a text-only place to note them.** The owner
chose neither (a) nor a fake number, but a third, honest option: a **free-text field, RM-C9 "Catatan Metrik
Tambahan"**, where the AM can *write down* CPL / impressions / CPC / CPM / organic views as prose for the
record. This is not option (a) in disguise — it is explicitly **not a metric**: it never enters a delta, a
rollup, a chart, or a score, and the system never parses a number out of it. It is a notepad, so a figure the
AM has in hand from a platform dashboard is not lost, while the metric column itself honestly stays `—` until
the source is really modelled. If CPL is later modelled in M8, RM-C9 stops being where it lives.

#### C. RM-6 — the notification catalog for sign-off (premise corrected)

The SESI1 spec (and the owner's question) assumed the catalog is **"v3 = 31 events."** That snapshot is
**out of date.** Since M6B PA-8 was written, the catalog grew through several owner-approved versions and the
count is asserted against a **version registry** (O55), not a literal. The live catalog in
`packages/core/src/notification.ts` is:

| Version | Introduced | +events | Running total |
|---|---|---|---|
| v1 | Phase 0 v2 §9 (15 frozen) + 2 lead-delete (2026-07-29) | 17 | 17 |
| v2 | M6A §7 D12 (4 Strategi) + M6B §9 (6 Plan) + M6C §10 (3 Gate) + `m6.client.assigned` (O53) | 14 | 31 |
| v3 | M5-OA-7 — 2 Finance (transaction-change ACC) | 2 | 33 |
| v4 | M6A §4 D-7 — 1 Strategi (Sanggahan Target) | 1 | 34 |
| v5 | Interview / Riset & Interview Klien tab 1 — 9 events | 9 | 43 |
| v6 | Interview part 2 — 1 event (prasyarat menggantung) | 1 | **44** |

So **the catalog is at v6 = 44 today**, not 31. (The "31" the owner saw is the running total *at the end of
v2* — which is where the M6B-era note froze.) **M6D adds a new version v7** — and with RM-8 now mandatory,
it is **4 events, → v7 = 48**:

| # | Event | Fires when | Recipients |
|---|---|---|---|
| 45 | `rekap_mingguan_terbuka` | Weekly recap opens (Monday job) | AM/CRO owning the client |
| 46 | `rekap_mingguan_belum_dikonfirmasi` | Not confirmed N (=2) working days after week close | AM/CRO + SPV |
| 47 | `rekap_sengketa_angka` | AM files `Sengketa Angka` on an auto figure | SPV |
| 48 | `catatan_divisi_belum_diisi` | A division owing a mandatory weekly note (RM-8) hasn't filed by close | Division lead + AM |

**The full 44 live events are enumerated in `docs/handoff/HANDOFF_M6D_SESI2.md` §Katalog.**
Sign-off was the single gate pending since M6B PA-8: no module ships notifications until the owner signs the
catalog. **The owner signed off `v7 = 48` on 2026-08-13** (*"Iya ini benar."*, `DECISIONS.md`), so the PA-8
gate is now **cleared** and D-07 is unblocked. It is registered as one `notif_catalog_versions` row
(`eventCount: 4`) in the D-07 migration — the invariant test counts `registeredEventCount()` from the registry,
so **do not** hardcode the literal 48 (O55).

---

## 11. Success Metrics

**Activation event.** First weekly recap **closed by an AM** (not `Ditutup Otomatis`) with complete auto figures and a written narrative — not "recap created" (creation is automatic and therefore meaningless as a signal).

**North star.** % of active clients whose **current** week recap is closed by its AM with a complete narrative. Target ≥ 90%. This catches the two ways the recap dies: never looked at (auto-closed empty), or looked at but never narrated (numbers with no story).

| Metric | Why | Target |
|---|---|---|
| % recaps closed by AM vs `Ditutup Otomatis` | Auto-close = the weekly review was skipped | ≥ 85% AM-closed |
| % **no-Plan** clients with a closed weekly recap | The specific gap R2 exists to close — proves Direct/`Tanpa Plan` clients now have a results trail | ≥ 90% |
| Median hours from week close → recap confirmed | A weekly cadence only works if it is timely | ≤ 48 h |
| % recaps with a substantive RM-D narrative (not just "aman") | The recap is worthless as pure number-echo; the narrative is the point | reviewed, not scored |
| `Sengketa Angka` rate per division | High rate = an execution module's auto figure is mistrusted → fix the source, not the recap | tracked per division |
| % active clients whose health view shows a recap ≤ 7 days old (H-2) | The integration's own test: `/health` is only a real summary if the results half is current | ≥ 90% |

**Anti-vanity guard.** Do not headline "recaps created" or "recaps closed on time" — the first is automatic, the second rises when an AM rubber-stamps. Pair the close rate with the no-Plan coverage rate and the narrative-substance review, which cannot be moved by clicking confirm.
