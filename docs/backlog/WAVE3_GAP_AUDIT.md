# WAVE 3 — GAP AUDIT (dibuka 2026-08-19, sesi 1)

> **Konteks.** Wave 2 gap-audit selesai (HANDOFF SESI46 — "gap Wave 2 HABIS").
> Modul Wave 3 (M2, M3, M11, M13, M14, M15) **sudah di-port** dari Go oracle selama
> cutover (lihat `HANDOFF_WAVE3_PORT_M2/M3/M14_M15.md`, `WAVE3_PLAN.md`) tapi **belum
> pernah** lewat gap-audit PRD-vs-implementasi seperti Wave 2. Dokumen ini adalah audit
> itu: setiap PRD Wave 3 dibandingkan dengan kode TS terkini + Go oracle + house rules.
>
> **Metode.** 6 audit paralel (satu per modul), tiap temuan diberi kelas keparahan:
> **A** = blokir exit-criteria Wave 3 / bug correctness / money / permission;
> **B** = requirement PRD atau item DoD hilang, non-blocking;
> **C** = deferred/blocked by-design (sudah ter-log) atau observasi.
>
> **Baseline hijau saat audit:** 6 suite domain Wave 3 = **102 test hijau**
> (marketing 15 · campaign 21 · board 16 · health 17 · performance 27 · portal 6),
> DB fresh 119 migrasi / 121 tabel, `route-parity` `KNOWN_GAPS` kosong.

## Ringkasan keparahan

| Modul | Verdict port | Gap A | Gap B | Gap C | Highest-priority |
|---|---|---|---|---|---|
| **M2 Marketing** | Faithful, near line-for-line | 0 | G1✅,G3✅,G5✅,G6✅ | G2,G4,G7 | **M2 B-cluster HABIS** ✅ |
| **M3 Campaign** | High-fidelity; linkage WRITE **ada** | 0 | G1✅,G2✅,G3✅,G4✅ | G5,G6 | **M3 B-cluster HABIS** ✅ |
| **M11 Board** | Faithful **kecuali gate roll-up** | **M11-G1 ✅** | M11-G2,G3 ✅ | G4,G5 | **M11-G1+G3 SELESAI** |
| **M13 Health** | Substansial, faithful | M13-G1* ✅ | — | G2,G3 | M13-G1 scheduler SELESAI (sesi 2) |
| **M14 Team Perf** | Salah satu paling lengkap | 0 | M14-G1 ✅ | G2,G3,G4,G5 | M14-G1 scheduler SELESAI (sesi 2) |
| **M15 Portal** | Team Portal lengkap; Client Portal ditunda | 0 | G1✅,G2✅ | G3–G7 | **M15 B-cluster (non-portal) HABIS** ✅ |

\* M13-G1 borderline A/B (logika ada + manual-invokable; hanya scheduler yang hilang).

---

## STATUS SESI 1

- ✅ **M11-G1 SELESAI** (sesi 1) — gate roll-up kini DEFER, bukan throw.

## STATUS SESI 2

- ✅ **M13-G1 + M14-G1 SELESAI** — scheduler snapshot bulanan: rute `POST /internal/health/tick`
  + `POST /internal/performance/tick` (Pattern A, shared-secret `PLAN_TICK_SECRET`, meniru
  `internal/plan/tick`). Keputusan pemilik 2026-08-19: Pattern A (bukan pg_cron/manual) + wiring
  provider cron (Vercel/GitHub Action) DITUNDA seperti plan/tick.
- ✅ **M11-G3 SELESAI** — omitempty di `cardToWire`/`dependencyToWire` diganti `null` eksplisit
  + FE mirror `board.ts` `string | null` + tes delivery di-update.
- ⏭️ Berikut: **M2-G1 / M3-G1** (requirement produk PRD), lalu sisa B kecil, lalu C OPEN.
  Client Portal (M15 C-cluster) TETAP terakhir (diblokir O4+O5 + ditunda pemilik).

## STATUS SESI 3

- ✅ **M2-G1 SELESAI** — dashboard compare-across-staff: field `owner` ditambahkan ke
  `marketing.Metrics` (= `Campaign.owner`, nol query baru — sudah di-fetch gate §5),
  wire `owner_employee_id` di `MarketingMetricsWire`, mirror FE `marketing.ts::Metrics`.
- ✅ **M3-G1 SELESAI** — per-campaign won-client list + service-status drill-down:
  `campaignClients(sql, actor, id)` (reuse gate §5, origin-campaign basis = `clientsWon`,
  LEFT JOIN `services`), rute `GET /marketing/campaigns/{id}/clients`, wire
  `CampaignClientWire`/`CampaignClientServiceWire` + FE `CampaignClient`/`getCampaignClients`.
- ⏭️ Berikut: sisa B kecil (M2-G3/G5/G6, M3-G2/G3/G4, M15-G1/G2), lalu C OPEN.
  Client Portal (M15 C-cluster) TETAP terakhir (diblokir O4+O5 + ditunda pemilik).

## STATUS SESI 4

- ✅ **Sisa B kecil HABIS** — M2-G3 (log FE-owned), M2-G5 (assert `err.message`), M2-G6
  (negative immutability test), M3-G2 (`updateCampaign` + PATCH), M3-G3 (assert blocked BI),
  M3-G4 (log Lead-create keputusan), M15-G1 (filter division-mix), M15-G2 (`boardRef`).
- **NOL migrasi baru** (murni domain+API+wire+FE+tes).
- ⏭️ Yang tersisa Wave 3: **C OPEN** (M11-G4, M2-G4/G7, M3-G6, M13-G2/G3, M14-*, M15-G3..G7)
  — verifikasi/log, bukan build. **Client Portal (M15 C-cluster) TETAP terakhir** (diblokir
  O4+O5 + ditunda pemilik).

---

## Temuan per modul

### M11 Board

- **M11-G1 — Severity A — ✅ SELESAI (sesi 1).** Gate Blocking-Dependency di jalur
  **roll-up** (`task.ts recomputeBriefRollup`, `kol.ts recomputeBriefRollup`) melempar
  `board.ConflictError` tanpa ditangkap ⇒ seluruh transaksi rollback, termasuk transisi
  child (Asset/Booking) pemicu. Akibat: meng-approve Asset/Booking terakhir dari Brief yang
  jadi Target Blocking-Dependency yang Source-nya belum terminal **gagal total** — melanggar
  §2 Rule 7 ("PIC tetap boleh lanjut kerja … yang ditolak cuma transisi ke gate terkunci")
  dan menyimpang dari Go oracle (`module12_task/rollup.go`: `errors.As(BlockedError)→return
  nil`) + keputusan W3-M11-C1. **Fix:** tangkap `board.ConflictError` di kedua roll-up caller
  → `return` (DEFER diam), Brief tetap `[In Review]`, child commit; jalur AM eksplisit
  (`account.ts driveReviewEdge`) TETAP throw. **Tes (M11-G2):** `board.test.ts` "Blocking gate
  DEFERS on the roll-up path" (Creative + KOL), terbukti gagal tanpa fix.
- **M11-G3 — Severity B — ✅ SELESAI (sesi 2).** `cardToWire`/`dependencyToWire` (`wire.ts`)
  memakai omitempty (drop key `pic`/`due_date`/`dependency_badge`/`created_at`/`note` saat
  kosong) — langsung melanggar house rule "kirim `null` eksplisit, jangan omitempty" (kelas
  O43). **Fix:** interface field-field itu → `string | null`, mapper emit `cond ? v : null`
  (preseden `installmentToWire`); FE mirror `board.ts` `Card`/`Dependency` → `string | null`;
  dua tes `wire.delivery.test.ts` yang meng-assert absence kunci → assert null eksplisit.
  Shape-parity tetap seimbang (membandingkan SET kunci).
- **M11-G4 — Severity C — OPEN.** My Tasks card `dependencyBadge` selalu `''` (paritas Go).
  "Same card structure" (§5.4) secara teknis tak terpenuhi. Verifikasi intent → log 1 baris.
- **M11-G5 — Severity C — non-gap.** Pesan gate tak dalam `[...]` = sesuai STATE_MACHINES §12
  template verbatim; jangan "diperbaiki" jadi bracket.

### M13 Client Health

- **M13-G1 — Severity A/B — ✅ SELESAI (sesi 2).** "Monthly batch job" (§5.2/OA-6)
  **tak punya scheduler**. `runSnapshotJob` benar + idempotent tapi satu-satunya entry =
  `POST /health/snapshots/scan` (actor-gated Director). Tak ada `pg_cron` maupun rute
  `internal/health/tick`. Tanpa scan manual: dashboard band kosong, trend berlubang permanen
  (tanpa backfill, DECISIONS 298). **Fix:** rute BARU `POST /internal/health/tick` (pola
  `internal/plan/tick`, shared-secret `PLAN_TICK_SECRET`, unset⇒closed, body `{waktu}` override)
  → `health.runSnapshotJob(db(), when)`; +4 tes secret-gate. Wiring cron eksternal (provider)
  DITUNDA seperti plan/tick (keputusan pemilik 2026-08-19: Pattern A).
- **M13-G2 — Severity C — ter-log (DECISIONS 298).** GMV Growth baca `clients.total_sales`
  (kolom mutable point-in-time), jadi tak period-accurate / tak recompute-from-log. Snapshot
  membekukan nilai → trend stabil. Diperparah G1 (sweep telat baca run-rate periode lain).
- **M13-G3 — Severity C — observasi.** Complaints/ROAS sub-score baca kolom sumber (mutable
  `severity`, `metric_entries`), bukan log immutable. Recompute-from-log ketat hanya berlaku
  untuk 3 komponen transition-sourced.

### M14 Team Performance

- **M14-G1 — Severity B — ✅ SELESAI (sesi 2).** Sama seperti M13-G1: snapshot bulanan hanya
  jalan lewat POST Director manual (`snapshots/scan`), tak ada cron. **Fix:** rute BARU
  `POST /internal/performance/tick` (pola sama, dipasangkan dengan M13-G1) →
  `performance.runSnapshotJob(db(), when)`; +4 tes secret-gate. Provider cron ditunda seperti
  plan/tick (keputusan pemilik 2026-08-19: Pattern A HTTP tick).
- **M14-G2 — Severity C — ter-log (W3-M14-C1).** `touchedClients` PIC linkage tak
  period-scoped; dibatasi hilir oleh syarat CHR snapshot periode sama + clamp ±10.
- **M14-G3/G4 — Severity C — benar/ter-log.** O9 target configurable + `is_placeholder`
  semua seed ditandai (RESOLVED). AM component transforms = interpretasi beralasan ter-log.
- **M14-G5 — Severity C — luar scope.** Success-metric telemetry (dashboard-open) tak
  di-instrument (bukan requirement build).

### M2 Marketing

- **M2-G1 — Severity B — ✅ SELESAI (sesi 3).** Dashboard Lead tak bisa "compare across staff"
  (§5 Rule 2): `Metrics`/wire tak bawa field owner/staff. **Fix (dieksekusi):** tambah `owner`
  (campaign owner employeeId) ke `marketing.Metrics`, isi dari Campaign yang sudah di-fetch gate
  §5 (**nol query baru**); wire `owner_employee_id` di `MarketingMetricsWire`; mirror FE
  `web-internal/src/lib/marketing.ts::Metrics`. Read-only (house rule 4). Tes: `m.owner` di
  worked-example + list Lead memuat owner ≥2 staff berbeda; wire mapper `.toEqual`.
- **M2-G3 — Severity B — ✅ DITUTUP-sbg-FE-owned (sesi 4).** Dashboard tak sort/flag
  low-ROAS/low-quality (§5 Rule 2). **Keputusan:** data-nya SUDAH lengkap di wire (`roas`,
  `lead_quality_rate`, dan kini `owner_employee_id` dari M2-G1) — sort & flag adalah murni
  presentasi. Threshold "low" butuh angka OKR yang tinggal di M13 (M2-G2, ter-log DECISIONS
  296/153), bukan di klaster M2. Jadi sort/flag = **FE-owned** (client-side atas wire yang ada);
  server tak menambah endpoint. Ter-log DECISIONS 2026-08-19 SESI4.
- **M2-G5 — Severity B — ✅ SELESAI (sesi 4).** Konstanta BI byte-exact tapi tes hanya assert
  error class. **Fix:** blok tes baru "verbatim BI messages on every error path" meng-assert
  `err.message` **persis** = `MSG_INCOMPLETE/FORBIDDEN/NOT_FOUND/DUPLICATE` pada createRecord
  (incomplete/forbidden/nf/dup), getRecord (nf/forbidden), updateBudget (incomplete/forbidden).
- **M2-G6 — Severity B(low) — ✅ SELESAI (sesi 4).** Tes immutability M2 buktikan append-only
  behavior, bukan UPDATE/DELETE ditolak. **Fix:** blok tes baru meng-assert UPDATE & DELETE
  pada baris `audit_log` (entity `marketing_performance_record`) **ditolak DB** oleh trigger
  house-wide `forbid_mutation()` (`/append-only\/immutable/`), lalu baris tetap `action='create'`.
- **M2-G2 — Severity C — ter-log (DECISIONS 296/153).** OKR OD di luar klaster M2 → M13.
- **M2-G4 — Severity C — OPEN(low).** CPRL floor (`Rp. 416.666,00`) vs contoh PRD `416.667`
  (rounding). Paritas Go. **Fix:** terima + log 1 baris "derived IDR ratio floor", jangan ubah
  diam (memecah oracle O43).
- **M2-G7 — Severity C — OPEN(low).** Director tak diuji di path read (metrics/dashboard).

### M3 Campaign

- **M3-G1 — Severity B — ✅ SELESAI (sesi 3).** Per-campaign **client list + service-status
  drill-down** (§4 Rule 4 / Flow 2) tak ada di TS maupun Go. Rollup cuma 4 angka. **Fix
  (dieksekusi):** `campaignClients(sql, actor, id)` (reuse gate §5 via `getCampaign`, sama
  seperti `campaignRollup`) — clients di mana `origin_campaign_id=id` (first-touch, **basis
  identik `Rollup.clientsWon`** ⇒ list & count rekonsiliasi, §4 Rule 5) LEFT JOIN `services`
  → name+status Account verbatim per Service; client tanpa Service → `services: []`. Rute
  BARU `GET /marketing/campaigns/{id}/clients` (shell tipis, `readAsActor`, `{data}`). Wire
  `CampaignClientWire`/`CampaignClientServiceWire` (named, bukan inline) + FE
  `CampaignClient`/`CampaignClientService`/`getCampaignClients`. Tes: 4 (own vs other campaign
  + service order, empty services LEFT JOIN, empty campaign, gate §5).
- **M3-G2 — Severity B — ✅ SELESAI (sesi 4).** Tak ada edit-field campaign (§6.1 "Create/edit/own").
  **Fix (dieksekusi):** `updateCampaign(sql, actor, id, input)` — edit field wajib §6.3 (Name,
  Channel, Online/Offline ≥1, Start Date), gated `canManageCampaign` (owning staff / lead / Director),
  validasi mirror `createCampaign` sebelum tulis, 1 baris audit before→after (action `edit`). Owner/
  Status/End Date TAK di sini (reassign / engine / efek Closed). Rute `PATCH /marketing/campaigns/{id}`
  + FE `updateCampaign`. Tes: edit+audit, validasi-sebelum-tulis, authority.
- **M3-G3 — Severity B — ✅ SELESAI (sesi 4).** Blocked-transition BI `[transisi status tidak diizinkan]`
  tak di-assert di tes M3. **Fix:** tes "illegal edges" kini assert `res.message === bi.TRANSITION_NOT_ALLOWED`.
- **M3-G4 — Severity B — ✅ DITUTUP-sbg-log (sesi 4).** `canCreate` izinkan Marketing Lead create
  (broadening dari §6.1 staff-only). **Keputusan:** BUKAN restrict — Lead sudah manage tiap campaign
  division-wide (`canManageCampaign`: transition/reassign/edit), jadi melarang create-saja = model
  otoritas tak konsisten; dan sesuai oracle Go (hindari O43 break). Ter-log DECISIONS 2026-08-19 SESI4
  + komentar pada `canCreate`.
- **M3-G5 — Severity C — ter-log (DECISIONS 2026-08-04).** `listSelectableCampaigns` semua status.
- **M3-G6 — Severity C — OPEN(low).** Campaign Name "text only" tak di-enforce (digit-only lolos).

### M15 Portal

- **M15-G1 — Severity B — ✅ SELESAI (sesi 4).** Management Dashboard tak punya filter
  "division mix" (§6.3). **Fix (dieksekusi):** param `filterDivision` di `managementDashboard`
  → `clientIdsInDivision` (Account = seluruh buku; lain = klien dengan ≥1 Brief `assigned_division`,
  scope IDENTIK `teamClients`) + wire `filter_division` + query param `?division=` + FE opsi
  `division`. Tes: filter Creative vs Ads, kosong = seluruh basis.
- **M15-G2 — Severity B — ✅ SELESAI (sesi 4).** `MgmtRow` tak bawa `boardRef` (drill-through
  Board §6.3). **Fix (dieksekusi):** `boardRef = /api/v1/board?client=<id>` (mirror
  `ClientShortcut.boardRef`, selalu ada) di `mgmtRowFor` + wire `board_ref` + FE. `snapshotId`
  tetap = sibling drill-through M13.
- **M15-G3..G7 — Severity C — BLOCKED/DEFERRED by design.** Client Portal (W3-M15-C2):
  realm auth terpisah, allow-list data layer, relabel service-progress + band client-facing,
  form komplain source=Portal. **Diblokir O4 (embeddability, OPEN tapi de-risked oleh report
  engine `report.ts` + `mode=klien`) + O5 (security spec DRAFT, 10 OQ terbuka)** DAN ditunda
  eksplisit pemilik 2026-07-18. **OQ-6 (ambiguitas PRD):** Rule 7 menyiratkan surface
  invoice/payment yang tak didefinisikan §2–§6 → butuh keputusan pemilik (M15 vs M5).

---

## Urutan tutup yang disarankan (sesudah M11-G1)

1. ✅ **M13-G1 + M14-G1 (scheduler bulanan) — SELESAI sesi 2.** Rute `internal/{health,performance}/tick`
   (Pattern A, shared-secret). Keputusan pemilik 2026-08-19: Pattern A + wiring provider ditunda
   seperti plan/tick. Sisa: wiring cron eksternal aktual saat deploy (Vercel Cron / GitHub Action).
2. ✅ **M11-G3 (omitempty wire) — SELESAI sesi 2.** Explicit null di `cardToWire`/`dependencyToWire`.
3. ✅ **M2-G1 / M3-G1 — SELESAI sesi 3** (compare-across-staff owner field, per-campaign
   won-client list + service-status drill-down). Nol migrasi baru.
4. ✅ **Sisa B (M2-G3/G5/G6, M3-G2/G3/G4, M15-G1/G2) — SELESAI sesi 4.** Nol migrasi baru.
5. **C yang OPEN → log keputusan / tes tambahan.** ← BERIKUTNYA
6. **Client Portal (M15 C-cluster)** TERAKHIR — jangan mulai sebelum O4+O5 tutup (keputusan
   pemilik + head dev). Bukan pekerjaan dev sekarang.

## Sumber kebenaran
- PRD `docs/prd/CDPS_Module{2,3,11,13,14,15}_*.md` — spec menang.
- Kode: `packages/domain/src/{marketing,campaign,board,health,performance,portal}.ts` (+ `task.ts`,`kol.ts`,`account.ts` untuk gate M11).
- Go oracle: `backend/internal/module{2,3,9,11,12,13,14,15}_*`.
- `WAVE3_PLAN.md` (klaster + titik keputusan O4/O5/O9), `DECISIONS.md`.
