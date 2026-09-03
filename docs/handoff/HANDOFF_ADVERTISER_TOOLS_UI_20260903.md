# HANDOFF — UI Gelombang 2 + 3 landed (Shopee form + /ads/screening), di atas `main` pasca-merge #277

**Tanggal:** 2026-09-03 (sesi lanjutan KEEMPAT hari yang sama — **baca ini
lebih dulu**, sebelum `HANDOFF_ADVERTISER_TOOLS_SC08_20260903.md` dan
`HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md`, yang keduanya kini sebagian
usang tapi tetap ada sebagai riwayat)
**Branch:** `claude/advertiser-tools-consolidation-handoff-96gswr` — bercabang
dari `origin/main` **setelah** PR #277 merge
**PR:** belum ada untuk branch ini — pemilik belum memintanya
**Pemilik permintaan:** Nerissa (COO), instruksi "baca handoff dan lanjutkan"

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo / branch** | `MEAgrup/AgencyAPP`, `claude/advertiser-tools-consolidation-handoff-96gswr` |
| **PR #276 / #277** | **SUDAH MERGE.** `origin/main` = `d6b8554` saat sesi ini mulai, dan branch ini dimulai persis dari sana. Jangan cari #277 lagi. |
| **Yang landed sesi ini** | Dua commit: (1) `b69e69b` UI laporan Shopee (SH-07), (2) `ce8f4eb` UI SKU Screener Modul A/B/C/D (SC-09). Plus commit dokumen. |
| **Sisa rencana 4-gelombang** | Gelombang 1 ✅ (di live) · Gelombang 2 ✅ (kode + UI, **belum di live**) · Gelombang 3 ✅ (kode + UI, **belum di live**) · **Gelombang 4 belum dimulai** |
| **⚠️ Live `CDPS SG` tertinggal 2 migrasi** | Lihat §4. Ini satu-satunya hal di handoff ini yang **butuh keputusan manusia**, bukan kode. |

---

## 1. Yang landed sesi ini

### 1.1 SH-07 — UI form laporan Shopee (commit `b69e69b`)

Gelombang 2 punya engine + domain + rute sejak sesi sebelumnya, tapi nol UI:
satu-satunya cara membuat laporan Shopee adalah POST manual.

- `web-internal/src/lib/report.ts`:
  - **`parseShopeeExportFile`** — pembaca export Shopee di browser. Dua
    perbedaan dari `parseExportFile` (TikTok), keduanya dituntut
    `@cdps/core` `report/shopee`: (a) **SEMUA worksheet** dibaca, bukan hanya
    yang pertama; (b) tiap sheet didahului baris penanda `__SHEET__:nama`
    (termasuk sheet PERTAMA, supaya bentuknya tidak bergantung pada jumlah
    sheet). Tanpa penanda itu setiap pemindai seksi di `metrik.ts` membaca
    tabel satu sheet **terus ke sheet berikutnya** — hasilnya angka salah pada
    respons 200, bukan error.
  - `createClientReportShopee`, `listShopeeAdsCampaigns`,
    `SHOPEE_MODULE_OPTIONS` (17 slot; LABEL saja — deteksi tetap server-side).
  - `sha256Hex` di `riset-awal.ts` kini di-export (dipakai kedua pembaca baru).
- `web-internal/src/components/clients/ShopeeReportForm.tsx` (BARU) — komponen
  sendiri, bukan cabang di dalam `ReportPanel`, karena input Shopee memang
  berbeda: `periode` (label) + rentang tanggal **WAJIB** (Shopee tak punya
  rentang dari berkas sama sekali), 17 override modul, dan daftar kampanye yang
  bisa dikecualikan.
- `ReportPanel.tsx` — radio **"Mesin laporan"** (TikTok/Shopee) di atas form.
  Mesin **DIPILIH**, bukan ditebak diam-diam: `client_platforms.platform` teks
  bebas (baris M4 bisa berbunyi "TikTok Shop, Shopee") dan KEDUA rute laporan
  tidak memeriksanya terhadap engine. Radio ter-preselect dari nama toko dan
  di-hitung-ulang tiap kali toko diganti.
- `packages/domain/src/report.ts` — **`listShopeeAdsCampaignsForPeriod`**, dan
  `apps/api/.../reports/shopee/campaigns/route.ts` (`GET`). Memakai predikat
  irisan **YANG SAMA** dengan pembagiannya
  (`ads.findOverlappingShopeeAdsCampaigns`) dan hanya menambahkan kolom
  tampilan di atas id yang predikat itu kembalikan — salinan kedua bisa
  menampilkan daftar yang berbeda dari pembagian yang seharusnya ia jelaskan.
  Gerbang **baca** (`canReadReport`), bukan tulis: OD boleh melihat, AM asing
  tidak.

### 1.2 SC-09 — UI SKU Screener, `/ads/screening` (commit `ce8f4eb`)

Halaman baru `web-internal/src/app/(shell)/ads/screening/page.tsx` + empat
komponen di `web-internal/src/components/skuscreener/`:

| Tab | Komponen | Isi |
|---|---|---|
| A · Screening | `ScreeningResultTable.tsx` | unggah Performa Produk (+ CPC opsional) → Target ROAS / CPC pasar / faktor CR → tabel rute per SKU + **blok median R04 ditampilkan** |
| B · Sebelum/Sesudah | `CompareResultTable.tsx` | dua export → pasangan per SKU + verdict R11 |
| C · Decision Log | `DecisionLogPanel.tsx` | form append-only `ADL-` + daftar |
| D · Tracker Optimasi | `TrackerPanel.tsx` | buka baris (sebelum) → isi sesudah → verdict R12 |

Plus `web-internal/src/lib/skuscreener-ui.ts` (formatter + tone, murni &
teruji) dan perluasan `web-internal/src/lib/skuscreener.ts` (pembaca payload,
kosakata Modul C/D, `parseSkuWorkbook`/`parseSkuCsvRows`, 9 fungsi API, dua
predikat akses).

**Keputusan desain yang jangan dibongkar tanpa alasan baru:**

1. **Blok median R04 DITAMPILKAN, tidak disembunyikan.** R04 melonggarkan ambang
   sampelnya sendiri 50% berulang sampai ≥5 SKU, dan bisa berhenti **terkunci di
   floor absolut** (CTR 2,0% / CR 0,5%). Rute yang dihitung terhadap median
   terkunci-floor adalah pernyataan yang jauh lebih lemah daripada terhadap
   median toko sungguhan — advertiser harus bisa melihat yang mana yang sedang
   ia lihat. Kolom "Kena floor absolut?" itu bukan hiasan.
2. **Tabel hasil membaca PAYLOAD run, tidak menurunkan ulang apa pun.** Rute
   yang dihitung halaman sendiri bisa berbeda dari run yang tersimpan, dan lalu
   tidak ada yang jadi catatan.
3. **`parseSkuWorkbook` mengirim SELURUH sheet beserta NAMA-nya** — server
   memilih sheet performa berdasarkan nama (`pickPerformaSheet`, A02) dengan
   fallback ke sheet pertama. Meratakan atau membuang sheet di browser
   mengambil pilihan itu dari server. (Beda dari Shopee, yang justru butuh
   diratakan + penanda. Dua engine, dua kontrak — jangan disamakan.)
4. **ID klien = KOLOM teks, bukan picker.** Alasannya panjang dan penting:
   lihat §3 dan SCR-UI-1 di `DECISIONS.md`.
5. **`canUseSkuScreener` satu predikat, dipakai BERSAMA** oleh gerbang halaman
   dan gate nav (pola `embedded-tools.ts`). Sengaja **BUKAN**
   `divisionQueue(ADS)` seperti `/ads`: itu antrian Brief (Account lead boleh
   masuk untuk memantau dispatch), ini alat pra-kampanye milik divisi Ads.
   Asimetri itu **diuji** di `nav.test.ts`.
6. **Trio data pendukung R14 dikirim hanya kalau ketiganya diisi.** Satu kolom
   kosong yang dibaca sebagai 0 akan menandai keputusan `PREMATUR` tanpa dasar.
7. **Kelas badge memakai yang benar-benar didefinisikan `globals.css`**
   (`badge-green` … `badge-darkgray`). Keluarga `badgeSuccess/badgeWarning/
   badgeDanger` yang dipakai `ReportPanel` **tidak punya style sama sekali** di
   `globals.css` — badge-badge itu tampil tanpa warna sejak Gelombang 1. Bug
   kosmetik pre-existing, TIDAK diperbaiki sesi ini (di luar cakupan), tapi
   sekarang tercatat: kalau mau dirapikan, satu tiket kecil sendiri.

---

## 2. Verifikasi — jalankan ulang, jangan percaya baris ini

Urutan yang dipakai (dan yang wajib diulang sebelum angka mana pun dikutip):

```bash
service postgresql start                     # container restart mematikannya
su postgres -c "psql -c \"alter user postgres password 'postgres'\""
npm ci                                       # root (apps/* + packages/*)
cd web-internal && npm ci && cd ..           # TERPISAH — bukan workspace root!
bash scripts/db-rebuild.sh --yes
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test --workspaces --if-present
cd web-internal && npm run typecheck && npm test && npm run build
```

Hasil di DB **fresh**:

```
db-rebuild    171 migrasi · tabel 143 · entity_prefix 39 · sm_machines 31 · 4 invariant SQL LOLOS
@cdps/core    500/500
@cdps/db      53/53
@cdps/domain  1761/1762 (1 skip) — naik dari 1756 (+5 test listShopeeAdsCampaignsForPeriod)
@cdps/api     398/398
web-internal  487/487 — naik dari 441 (+46: 5 report-shopee-parse, 22 skuscreener-ui, 14 skuscreener, 5 nav)
typecheck     4 workspace + web-internal bersih
next build    hijau, /ads/screening terdaftar sebagai route statis
eslint        `npm run lint -w @cdps/api -- --max-warnings 0` bersih (yang CI jalankan)
route-parity  11 panggilan FE baru DIPERIKSA LANGSUNG terdeteksi & terlayani (bukan cuma "nol yang hilang")
```

**Ralat angka yang sengaja ditulis di sini, bukan disembunyikan:** pesan commit
`b69e69b` (SH-07) menyebut "web-internal 451/451". Itu salah — hasil ukur
sungguhan pada commit itu adalah **446/446** (baseline 441 + 5 test parse
Shopee baru); 451 adalah hasil aritmetika yang keliru, bukan hasil ukur.
Baseline `main` pasca-merge = **441**, sama dengan yang tertulis di handoff
SC-08. Riwayat commit tidak ditulis ulang (perintah `git reset --hard`
diblokir di lingkungan sesi ini), jadi ralatnya hidup di sini.

---

## 3. Jebakan yang ditemukan sesi ini — jangan ulangi

1. **`web-internal` BUKAN npm workspace.** `package.json` root hanya
   mendaftarkan `apps/*` dan `packages/*`. `npm ci` di root **tidak** memasang
   dependensi `web-internal`, dan `npx tsc` di sana lalu gagal dengan
   `Cannot find module 'xlsx'` — yang terbaca seperti dependensi hilang, bukan
   seperti install yang belum jalan. Harus `cd web-internal && npm ci` sendiri.
   Konsekuensinya juga: `npm run typecheck` di root TIDAK mengecek
   `web-internal`, dan `npm test --workspaces` TIDAK menjalankan test-nya.
2. **`psql` dengan `postgres:postgres` gagal auth di container baru.**
   `db-rebuild.sh` jalan lewat socket sebagai OS user `postgres` (mode `su`),
   jadi ia sukses sementara test yang butuh `DATABASE_URL` gagal connect. Fix:
   set password sekali (`alter user postgres password 'postgres'`).
3. **`shape-parity.test.ts` (O43c) tetap butuh DUA pendaftaran** untuk tiap
   `*Wire` baru: `WIRE_TO_FE` map DAN `FE_FILES` array. `ShopeeAdsCampaignOptionWire`
   → `report.ts::ShopeeAdsCampaignOption`; `report.ts` sudah ada di `FE_FILES`
   jadi kali ini cukup satu baris. Field wire tetap **satu-field-per-baris**
   (parser regex, bukan compiler TS).
4. **`route-parity` bisa hijau secara VAKUUM.** "Nol endpoint hilang" juga
   benar kalau scanner-nya tidak mendeteksi panggilan FE baru sama sekali.
   Sesi ini memverifikasi langsung dengan `vite-node` memanggil
   `feCalls()`/`servedBy()` dan mencetak 11 panggilan baru + statusnya. Lakukan
   itu setiap kali menambah rute; jangan cukup dengan suite hijau.
5. **1 error lint `react-hooks/static-components`** di
   `web-internal/src/app/(shell)/admin/employees/page.tsx` — **PRE-EXISTING**
   (file itu tidak disentuh sesi ini; sudah tercatat di
   `CLIENT_REPORT_PORTAL_BACKLOG.md` Gelombang 1). CI **tidak** menjalankan
   lint `web-internal` (hanya `build` + `test`), jadi ini tidak memerahkan CI.
   Jangan panik melihatnya; jangan juga sekalian "diperbaiki" di tengah tiket
   lain tanpa tiketnya sendiri.
6. **`clients_select` (RLS) tidak punya lengan Ads.** Ini yang membentuk desain
   `/ads/screening`: gerbang tulis SKU Screener berbasis DIVISI
   (`skuscreener.canWriteSku` → Ads staff/lead/Director) sehingga advertiser
   boleh membuat screening untuk klien mana pun, TAPI ia tidak bisa
   **me-list** klien (`clients_select` hanya `sales_pic_id` /
   `assigned_am_id` / `commission_payment_pic_id` / `created_by`), dan
   `/clients` juga bukan menunya (`ownedBy(SALES, ACCOUNT, FINANCE)`). Picker
   klien di sana akan jadi **dropdown kosong justru bagi peran yang halaman itu
   ditujukan**. Jadi: kolom teks, ter-prefill dari `?client=`, dan halaman
   kampanye Ads (`/ads/[id]` — satu-satunya tempat advertiser sudah memegang id
   itu) kini menautkannya. Melebarkan RLS = perubahan akses data lintas-divisi
   → butuh keputusan pemilik, bukan sunting senyap di dalam tiket UI. Tercatat
   sebagai **SCR-UI-1** (Open).

---

## 4. ⚠️ BUTUH KEPUTUSAN MANUSIA — live `CDPS SG` tertinggal 2 migrasi

Diperiksa sesi ini lewat `mcp__Supabase__list_migrations` (read-only, project
`egddxfcnrtecheiykhlf`):

| | |
|---|---|
| Migrasi terakhir di live | `fix_working_days_between_execute_surface` (= berkas repo `20260908040000`) |
| Ada di `main`, **BELUM di live** | `20260908050000_gelombang3_sku_screener.sql`, `20260909010000_sh01_shopee_report_engine.sql` |

**Artinya:** begitu `main` ter-deploy, halaman `/ads/screening` dan form
laporan Shopee akan 500 di produksi — tabelnya belum ada di sana. Kode dan DB
live saat ini tidak sinkron.

**Menerapkannya adalah tindakan produksi yang sulit dibalik, jadi TIDAK
dilakukan sesi ini tanpa persetujuan eksplisit.** Kalau sudah disetujui:

1. Terapkan **lewat `mcp__Supabase__apply_migration`**, satu per satu, urut
   (`20260908050000` dulu, lalu `20260909010000`) — **BUKAN**
   `supabase db push` (lihat O65: ledger live memakai nama berbeda dari berkas
   repo; `db push` bisa salah menilai apa yang sudah ada).
2. Sesudahnya verifikasi ulang gate hitungan di live: `entity_prefix` harus
   **39** (bukan 37 — dua prefix baru `SCR-` dan `ADL-`), tabel bertambah 4
   (`screening_run`, `ads_decision_log`, `optimization_tracker`,
   `report_benchmark_shopee`), `sm_machines` tetap **31**, `notif_events` tetap
   **67**.
3. `report_benchmark_shopee` harus punya **satu baris `aktif = true`** — tanpa
   itu `createReportShopee` menolak dengan `[benchmark laporan belum
   dikonfigurasi]`. Migrasi `20260909010000` yang menyeednya; pastikan
   baris itu benar-benar ada di live setelah apply.
4. Belum pernah ada satu laporan pun (TikTok maupun Shopee) yang dibuat dari
   export **ASLI** lalu dibaca kontak klien sungguhan — semua verifikasi masih
   fixture. UAT itu milik pemilik/AM, bukan sesi Claude (sisa Gelombang 1 yang
   masih terbuka).

---

## 5. Urutan kerja yang disarankan untuk sesi berikutnya

1. **Gelombang 4 — AS-01…AS-04 (TikTok Ads Scanner).** Ini satu-satunya
   gelombang yang belum dimulai. O69 sudah **RESOLVED** (pemilik memilih tabel
   CDPS baru, mirror pola `screening_run`) dan O67 **RESOLVED** (port penuh ke
   `packages/core/`, bukan embed). Engine
   `packages/core/src/adsscanner/tiktok/` **sudah lengkap dan teruji**;
   yang belum ada: migrasi, domain layer, rute, UI. Pola yang tinggal diikuti
   persis: `20260908050000` + `packages/domain/src/skuscreener.ts` +
   `/ads/screening` yang baru landed sesi ini.
2. **Terapkan 2 migrasi ke live** — setelah pemilik setuju (§4).
3. **SCR-UI-1** — tanyakan ke Yohan/Nerissa apakah divisi Ads perlu bisa
   me-list klien. Kalau ya, itu rute picker sempit + entri `DECISIONS.md`,
   bukan pelebaran `clients_select` apa adanya.
4. **Sidebar IA v3** (`docs/CDPS_Sidebar_IA_v3.md`) — masih track terpisah dan
   masih butuh keputusan produk untuk 3 pasang halaman yang mungkin duplikat.
   Catatan baru: menu bertambah satu baris sesi ini (`/ads/screening`), jadi
   kalau reorganisasi dikerjakan, hitung ulang dari `nav.ts` yang sekarang.
5. **PR untuk branch ini** — belum dibuat; pemilik belum memintanya. Jangan
   buat tanpa diminta (aturan rumah sesi ini), dan jangan merge apa pun atas
   inisiatif sendiri.

---

## 6. Peta berkas (orientasi cepat)

**SH-07 (UI Shopee):** `web-internal/src/components/clients/ShopeeReportForm.tsx`,
`web-internal/src/components/clients/ReportPanel.tsx` (radio mesin),
`web-internal/src/lib/report.ts` (bagian akhir: `parseShopeeExportFile`,
`SHOPEE_MODULE_OPTIONS`, `createClientReportShopee`, `listShopeeAdsCampaigns`),
`packages/domain/src/report.ts` (akhir: `listShopeeAdsCampaignsForPeriod`),
`apps/api/src/app/api/v1/clients/[id]/reports/shopee/campaigns/route.ts`,
test `web-internal/src/lib/report-shopee-parse.test.ts` +
`packages/domain/src/report.shopee.domain.test.ts` (5 test terakhir).

**SC-09 (UI SKU Screener):**
`web-internal/src/app/(shell)/ads/screening/page.tsx`,
`web-internal/src/components/skuscreener/{ScreeningResultTable,CompareResultTable,DecisionLogPanel,TrackerPanel}.tsx`,
`web-internal/src/lib/skuscreener.ts` (pembaca payload, kosakata, parser, API
client, `canUseSkuScreener`/`canWriteSkuScreener`),
`web-internal/src/lib/skuscreener-ui.ts`, `web-internal/src/lib/nav.ts`
(satu baris + gate), `web-internal/src/app/(shell)/ads/[id]/page.tsx` (tautan
masuk), test `skuscreener-ui.test.ts` / `skuscreener.test.ts` /
`nav.test.ts`.

**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` (baris
Status sudah diperbarui), `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`
(Gelombang 2 & 3 kini bertanda ✅, SC-08 = domain+API, SC-09 = UI).

**Keputusan:** `docs/DECISIONS.md` — baris teratas tabel Decided
("UI Gelombang 2+3 landed"), dan **SCR-UI-1** di tabel Open.

**Handoff rantai (baca yang terbaru dulu):** dokumen ini →
`HANDOFF_ADVERTISER_TOOLS_SC08_20260903.md` →
`HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md`.
