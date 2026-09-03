# HANDOFF — SC-08 (MEA SKU Screener domain+API) landed, di atas SH-06

**Tanggal:** 2026-09-03 (sesi lanjutan ketiga hari yang sama — baca ini SEBELUM
`HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md`, yang isinya sekarang sebagian
usang; dokumen itu tetap ada sebagai riwayat Gelombang 2-4 asli + SH-06)
**Branch:** `claude/advertiser-tools-consolidation-waves-6tl68h` — sudah di-push
**PR:** [#277](https://github.com/MEAgrup/AgencyAPP/pull/277) (draft, base `main`, bergantung pada [#276](https://github.com/MEAgrup/AgencyAPP/pull/276) yang JUGA masih draft/belum di-review pemilik)
**Pemilik permintaan:** Yohan (Director)

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo / branch** | `MEAgrup/AgencyAPP`, `claude/advertiser-tools-consolidation-waves-6tl68h` — sudah di-push ke origin, tidak ada commit lokal belum ter-push |
| **PR #277** | Draft, `mergeable_state: clean`, CI hijau semua (13/13 check terakhir dicek). **JANGAN MERGE** — bergantung pada #276 yang juga draft & belum direview pemilik. Merge adalah keputusan pemilik, bukan sesi Claude manapun — jangan unilateral. |
| **PR #276** | Draft terpisah (Gelombang 1: insight editable + Client Portal), belum direview/di-merge pemilik. #277 bercabang dari branch-nya, jadi diff #277 saat ini = #276 + semua kerja sesi-sesi lanjutan (SH-06, SC-08). |
| **Migrasi live** | BELUM ada migrasi baru diterapkan ke `CDPS SG` (project id `egddxfcnrtecheiykhlf`) sesi ini — semua verifikasi lokal saja, sesuai catatan di PR #277 sendiri ("cek lokal saja sampai #276 dan PR ini di-review"). |
| **Urutan kerja sesi ini** | 1) Lanjutkan dari `HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md` §0.0 (SH-06 sudah landed sebelumnya). 2) User eksplisit minta "lanjutkan task, lalu selesaikan PR merge/commit/push yg dibutuhkan, beri handoff". 3) Dikerjakan: **SC-08** (domain+API layer penuh untuk MEA SKU Screener, Gelombang 3) — lihat §1. 4) "PR merge" DIBACA sebagai "commit+push yang diperlukan", BUKAN literal klik-merge — lihat §4 kenapa. |

---

## 1. Yang landed sesi ini — SC-08 (domain + API, MEA SKU Screener)

Migrasi schema-only `20260908050000_gelombang3_sku_screener.sql` (dari sesi
sebelumnya) sekarang punya domain layer + rute API penuh di atasnya.

### 1.1 `packages/domain/src/skuscreener.ts` (BARU, ~700 baris)

Empat verb utama, satu per modul PRD (`docs/design/PRD_MEA_SKU_SCREENER_v1.0.md`):

- **Modul A — `runScreening`**: parse "Bisnis Saya → Performa Produk" (+ CPC
  iklan opsional) SERVER-SIDE (browser cuma convert xlsx→AoA + hash, pola
  RAB-04 yang sama seperti `report.ts`/`riset-awal.ts`), hitung median R04,
  `classifySku` per SKU (R05 routing + R06 CPC-max/anti-rule/TAHAN), insert
  `screening_run` (`jenis='screening'`).
- **Modul B — `runCompare`**: cocokkan SKU dua periode (R09 `matchSkus`),
  `compareBeforeAfter` per pasangan (R10/R11), insert `screening_run`
  (`jenis='perbandingan'`). Ringkasan sudah diverifikasi terhadap skenario
  konkret PRD §4.2 (Sneakers Outdoor Trail — CTR +34,4% → MEMBAIK).
- **Modul C — `logDecision`**: APPEND-ONLY ke `ads_decision_log`.
  `status_vs_target` dihitung (lihat §3 judgment call), `premature` R14
  dihitung dari `dataPendukung` opsional (klik/konversi/hari — TIDAK
  disimpan sebagai kolom terpisah, cuma flag-nya). Baris `review_7_hari`
  (follow-up 7 hari, pola 2-baris sesuai O68 yang sudah RESOLVED) divalidasi:
  wajib `reviewsDecisionId` yang menunjuk baris ADL- klien yang SAMA dan
  BUKAN baris review lain.
- **Modul D — `createTrackerRow` / `recordTrackerAfter`**: SATU-SATUNYA
  tabel Gelombang 3 yang MUTABLE (`optimization_tracker`, pola
  `set_updated_at` — skema sendiri sudah membedakan ini dari dua tabel lain
  yang `forbid_mutation`). `createTrackerRow` insert `before_*` +
  `initial_route` + `change_type` (product_code diresolve lewat `skuKey`
  R09 — SAMA fungsi yang dipakai Modul B, supaya identity selalu setuju).
  `recordTrackerAfter` isi `after_*`, hitung delta/verdict lewat
  `evaluateOptimization` (R12).
- **Reads**: `listScreeningRuns`/`getScreeningRun`/`listDecisions`/
  `listTrackerRows` — gerbang baca (`canReadSku`) MENCERMINKAN PERSIS
  predikat RLS migrasi `20260908050000` sendiri (`canReadAll` ATAU pembuat
  baris ATAU salah satu kolom PIC klien `jwt_owns_client`-equivalent ATAU
  lead divisi Ads) — dibaca dari SQL policy yang sudah ada, bukan ditebak
  ulang.
- **Gerbang tulis** (`canWriteSku`): impor `ads.canManageCampaign` LANGSUNG
  (Ads staff/lead/Director) — PRD "Advertiser"/"Lead Advertiser" persis
  aktor M8, jadi reuse, bukan gerbang kedua.

Perubahan kecil di `@cdps/core`: `packages/core/src/skuscreener/compare.ts`
— `relDeltaPct` (helper lokal) di-`export`, dipakai `recordTrackerAfter`
untuk `delta_ctr_pct`/`delta_cr_pct` generik (di luar `metric_evaluated`
yang sudah dihitung `evaluateOptimization`) tanpa menulis ulang formulanya.

### 1.2 Rute API (11 file baru) + `web-internal/src/lib/skuscreener.ts`

```
POST /api/v1/clients/{id}/skuscreener/screening   — runScreening
POST /api/v1/clients/{id}/skuscreener/compare     — runCompare
GET  /api/v1/clients/{id}/skuscreener/runs        — listScreeningRuns (?jenis=)
GET  /api/v1/clients/{id}/skuscreener/decisions   — listDecisions
POST /api/v1/clients/{id}/skuscreener/decisions   — logDecision
GET  /api/v1/skuscreener/runs/{id}                — getScreeningRun
GET  /api/v1/skuscreener/runs/{id}/tracker        — listTrackerRows
POST /api/v1/skuscreener/runs/{id}/tracker        — createTrackerRow
POST /api/v1/skuscreener/runs/{id}/tracker/{productCode}/after — recordTrackerAfter
```

`apps/api/src/lib/wire.ts`: 5 tipe wire baru (`ScreeningRunSummaryWire`,
`ScreeningRunDetailWire`, `DecisionLogEntryWire`, `TrackerMetricsWire`,
`TrackerRowWire`) + converter masing-masing.

`web-internal/src/lib/skuscreener.ts` (BARU) — **TIPE FE MURNI, nol
halaman/komponen memakainya.** Dibuat semata supaya
`apps/api/src/lib/shape-parity.test.ts` (guard O43c) mengawasi bentuk sejak
hari pertama, sama pola dengan SH-06's route Shopee. Terdaftar di
`shape-parity.test.ts`'s `WIRE_TO_FE` map DAN `FE_FILES` list (**dua tempat
wajib** — daftar di `WIRE_TO_FE` saja tidak cukup, `FE_FILES` adalah daftar
file yang benar-benar di-scan; lupa salah satu = test gagal dengan pesan
"missing FE types" walau filenya sudah ada, lihat §3).

### 1.3 Test — `packages/domain/src/skuscreener.test.ts` (25 test baru)

DB-gated (skip tanpa `DATABASE_URL`), prefix `ZZSK-` (baru — cek daftar
prefix yang sudah dipakai file test lain sebelum pilih prefix baru:
`ZZ-`/`ZZC-`/`ZZD-`/`ZZJ-`/`ZZM-`/`ZZP-`/`ZZR-`/`ZZRS-`/`ZZT-`/`ZZX-` sudah
terpakai). Sengaja TIDAK menghitung ulang median/rute secara manual di
test — memanggil fungsi `@cdps/core` YANG SAMA untuk membangun nilai
"expected", supaya yang diuji adalah WIRING domain (parse→engine→payload→
persist→permission), bukan re-derivasi R01-R16 (sudah dites 59x di
`packages/core`). Cakupan: routing+payload, validasi target ROAS,
error parse dibungkus `[...]`, gerbang tulis (Account AM/OD ditolak),
immutability (`screening_run`/`ads_decision_log` UPDATE+DELETE ditolak
trigger), matching Modul B + skenario PRD §4.2, `MSG_NO_MATCH`, semua
cabang Modul C (status_vs_target, roas_result null-safety, premature,
validasi baris review lengkap), Modul D (create+record-after+duplicate+
verdict BELUM CUKUP DATA), dan gerbang baca utk ketiga jenis listing.

---

## 2. Verifikasi — dijalankan ulang independen di db-rebuild FRESH

```
db-rebuild   171 migrasi · tabel 143 · 4 invariant SQL LOLOS
@cdps/core   500/500
@cdps/db     53/53
@cdps/domain 1756/1756 (1 skip) — naik dari 1731 (SH-06) + 25 (SC-08 baru)
@cdps/api    398/398 (termasuk shape-parity.test.ts — lihat §3 jebakan #2)
web-internal 441/441 · tsc bersih
typecheck    4 workspace backend bersih
```

**Jangan percaya baris di atas — jalankan ulang** dengan
`bash scripts/db-rebuild.sh --yes` dulu (lihat §3 jebakan #1 kenapa ini
wajib SEBELUM percaya angka test manapun sesi ini).

---

## 3. Jebakan yang ditemukan sesi ini — jangan ulangi

1. **Container di-restart di antara giliran chat → Postgres mati, data
   TETAP ADA.** `service postgresql status` sempat menunjukkan "down"
   padahal DB `cdps` sebelumnya sudah dibangun lengkap (143 tabel). Fix:
   `service postgresql start` (bukan rebuild — rebuild hanya kalau memang
   perlu skema baru atau state-nya diragukan).
2. **Menjalankan ulang suite yang sama BERKALI-KALI tanpa `db-rebuild.sh`
   di antaranya membuat test dengan ID LITERAL (bukan namespaced-per-run)
   gagal palsu.** Contoh nyata sesi ini: `admin.test.ts` ("hari libur",
   pakai konstanta `TANGGAL`) dan `client.test.ts` ("Hold Service",
   `SVC-HOLD-${seq}` dengan `seq` reset tiap load modul) — keduanya
   menghitung baris `audit_log` (append-only, TIDAK PERNAH dibersihkan by
   design) dengan `expect(...).toBe(1)`. Re-run suite yang sama tanpa
   rebuild → row lama numpuk → assertion `toBe(1)` gagal dengan angka besar
   (7, 5, 3, ...). **INI BUKAN REGRESI dari kerja SC-08/SH-06** — sudah
   diverifikasi dengan cara membuang file test baru lalu jalan ulang di DB
   fresh (hijau), lalu pasang lagi (masih hijau). Aturan: SELALU
   `db-rebuild.sh --yes` sebelum putaran verifikasi FINAL yang angkanya mau
   dipercaya/dikutip; re-run cepat di tengah development boleh tanpa
   rebuild asal tahu dua test ini bisa "false red".
3. **`shape-parity.test.ts` (O43c) — dua jebakan sekaligus saat menambah
   Wire type baru TANPA halaman FE yang memakainya:**
   - Field wire interface **WAJIB satu-field-per-baris** (`views: number;`
     baris sendiri, bukan digabung `views: number; clicks: number;` satu
     baris) — parsernya regex (`/^ {2}([A-Za-z_]\w*)\??:\s*(.*?)\s*$/gm`),
     bukan compiler TS sungguhan, dan menganggap SATU baris = SATU field.
     Field yang digabung satu baris membuat field ke-2 dst hilang dari
     hasil parse tanpa error yang jelas nunjuk ke sini — pesannya
     "TrackerMetricsWire never emits: clicks, ctr, cr, orders" (field yang
     hilang), bukan "salah format".
   - Interface baru harus terdaftar di **DUA tempat**: `WIRE_TO_FE` map
     (`'FileWire': 'file.ts::Interface'`) DAN `FE_FILES` array (daftar file
     yang benar-benar dibaca dari `web-internal/src/lib/`) — daftar di
     `WIRE_TO_FE` saja gagal dengan "missing FE types" walau file FE-nya
     sudah ada persis dengan isi benar, karena filenya tidak pernah dibaca.
   - Guard ini TIDAK opt-in seperti dugaan awal — SETIAP `export interface
     *Wire` di `wire.ts` (termasuk tipe nested seperti `TrackerMetricsWire`
     yang cuma dipakai sebagai field `before`/`after`) WAJIB punya
     pasangan FE, walau belum ada halaman yang membacanya. Kalau nanti mau
     nambah wire type murni internal tanpa niat FE sama sekali, itu butuh
     didiskusikan (belum ada preseden "wire tanpa FE" di guard ini).
4. **`npm test`/`npm run typecheck` tanpa `-w <package>` atau `cd` absolut
   yang benar bisa jalan di package yang SALAH** — beberapa kali cwd tidak
   seperti yang diharapkan (kemungkinan tiap `Bash` call di lingkungan ini
   tidak selalu mewarisi `cd` dari call sebelumnya persis seperti
   didokumentasikan). Selalu `pwd` dulu kalau ragu, atau pakai `cd
   /path/absolut && <command>` dalam SATU call.

---

## 4. Kenapa "PR merge" TIDAK dilakukan sesi ini

Permintaan user: *"selesaikan pr merge commit push yg dibutuhkan"*. Dibaca
sebagai **commit+push yang diperlukan untuk kerja sesi ini**, BUKAN
literal klik tombol merge, karena:

- PR #277 sendiri eksplisit: *"Jangan merge PR ini sebelum #276."*
- PR #276 (yang di-branch-i #277) **masih draft, belum direview pemilik**
  — test plan-nya sendiri mencantumkan "Owner menjawab O68 & O69" (sudah,
  lihat handoff sebelumnya) tapi juga "Review PRD/HTML sumber vs port" dan
  "db-rebuild.sh hijau di mesin reviewer" yang belum ada konfirmasi
  eksplisit dari Yohan.
- Merge dua PR besar (Gelombang 1 + 2 + 3 SC-08, ~16rb baris gabungan) atas
  inisiatif sendiri tanpa review pemilik adalah tindakan besar &
  sulit-dibalik — di luar wewenang default sesi manapun tanpa instruksi
  eksplisit "merge PR #276/#277 sekarang".

**Yang SUDAH dilakukan:** commit + push ke branch `claude/advertiser-tools-consolidation-waves-6tl68h`
(PR #277 ter-update otomatis, sudah di-subscribe untuk aktivitas PR sejak
sesi SH-06). CI terakhir dicek hijau semua, `mergeable_state: clean`.

**Kalau sesi berikutnya DIMINTA EKSPLISIT untuk merge:** urutannya HARUS
#276 dulu (base), baru #277 — dan hanya setelah pemilik mengonfirmasi
review-nya, sesuai catatan test plan di kedua PR.

---

## 5. Urutan kerja yang disarankan untuk sesi berikutnya

1. **UI `web-internal`** untuk SH-06 (form upload laporan Shopee + daftar
   exclude campaign) DAN SC-08 (form Modul A/B, layar Decision Log Modul C,
   Tracker Modul D) — keduanya murni UI di atas domain/API yang sudah ada
   dan teruji, belum ada satu baris pun. Ini pekerjaan TERBESAR yang
   tersisa dari seluruh rencana 4-gelombang.
2. **AS-0x** (domain/DB layer TikTok Ads Scanner, Gelombang 4) — O69 sudah
   RESOLVED (tabel CDPS baru, mirror `screening_run`), belum ada migrasi
   ataupun domain layer sama sekali untuk Ads Scanner. Engine
   `packages/core/src/adsscanner/tiktok/` sudah siap pakai.
3. **Sidebar IA v3** (`docs/CDPS_Sidebar_IA_v3.md`) — track terpisah, tanya
   dulu ke Nerissa/Yohan apakah reorganisasi PENUH mau dikerjakan sekarang
   (3 pasang halaman kemungkinan duplikat perlu keputusan produk dulu) atau
   tetap sebatas label yang sudah diminta (`web-internal/src/lib/nav.ts`).
4. Kalau pemilik sudah review #276 dan #277: bawa PR #276 ke merge dulu
   (base), baru #277 — JANGAN sesi mana pun memutuskan sendiri untuk itu
   tanpa instruksi eksplisit.
5. Setelah #276 merge ke `main`: migrasi baru (`20260908050000`,
   `20260909010000`, dan migrasi Gelombang 1 di #276) perlu diterapkan ke
   `CDPS SG` live via `apply_migration` (BUKAN `supabase db push` — lihat
   O65) — belum pernah dilakukan sepanjang seluruh rencana 4-gelombang ini.

---

## 6. Peta berkas (orientasi cepat)

**Kode SH-06:** `packages/domain/src/report.ts` (`createReportShopee`,
`attributeShopeeAdsMetricEntries`), `packages/domain/src/ads.ts`
(`insertMetricEntryFromReportEngine`, `writeMetricEntryRow`,
`findOverlappingShopeeAdsCampaigns`), `apps/api/src/app/api/v1/clients/[id]/reports/shopee/route.ts`,
test `packages/domain/src/report.shopee.domain.test.ts`.

**Kode SC-08:** `packages/domain/src/skuscreener.ts` (BARU, semua 4 modul),
`apps/api/src/app/api/v1/clients/[id]/skuscreener/**` +
`apps/api/src/app/api/v1/skuscreener/runs/[id]/**` (BARU, 11 file route),
`apps/api/src/lib/wire.ts` (bagian akhir file — 5 tipe + converter),
`web-internal/src/lib/skuscreener.ts` (BARU, tipe FE murni), test
`packages/domain/src/skuscreener.test.ts`.

**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md`,
`docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`.

**Keputusan:** `docs/DECISIONS.md` — cari entri SC-08 dan SH-06 tanggal
2026-09-03 (paling atas tabel Decided), O66-O69 di tabel Open (semua sudah
RESOLVED).

**Handoff rantai (baca yang terbaru dulu):** dokumen ini →
`HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md` (Gelombang 2-4 asli + SH-06).
