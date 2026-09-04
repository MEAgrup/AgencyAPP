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
| **Sisa rencana 4-gelombang** | Gelombang 1 ✅ · Gelombang 2 ✅ · Gelombang 3 ✅ — ketiganya kode + UI + **migrasi sudah di live** · **Gelombang 4 belum dimulai** |
| **Live `CDPS SG`** | ✅ SINKRON dengan `main` — 2 migrasi diterapkan 2026-09-03 (§4). Keputusan pemilik yang tersisa: **SHP-1..SHP-3** dari UAT export asli. |

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

## 4. Live `CDPS SG` — SUDAH SINKRON (2 migrasi diterapkan 2026-09-03)

Pemilik (Nerissa) memilih **opsi C**: terapkan migrasi **dan** UAT dengan export
Shopee asli. Keduanya dikerjakan sesi ini.

**Yang diterapkan** — lewat `mcp__Supabase__apply_migration`, satu per satu,
urut, project `egddxfcnrtecheiykhlf`:

| Berkas repo | Nama di ledger live | Versi ledger |
|---|---|---|
| `20260908050000_gelombang3_sku_screener.sql` | `gelombang3_sku_screener` | `20260903160219` |
| `20260909010000_sh01_shopee_report_engine.sql` | `sh01_shopee_report_engine` | `20260903160257` |

Nama & versi ledger live **berbeda** dari nama berkas repo — itu bukan kesalahan
sesi ini, itu O65 yang sudah lama terbuka (ledger live memakai timestamp saat
apply). Karena itulah `apply_migration`, **bukan `supabase db push`**: `db push`
membandingkan nama berkas dengan ledger dan bisa salah menilai apa yang sudah
ada.

**Diperiksa SEBELUM apply** (bukan sesudah — kalau ada drift, apply-nya yang
harus dibatalkan, bukan diperbaiki belakangan):

- Daftar relasi live vs lokal-pra-migrasi di-diff **dua arah**: 140 vs 140,
  keduanya KOSONG. Nol drift.
- `client_reports` **0 baris** di live. Ini yang membuat
  `ck_report_benchmark_by_schema` aman: CHECK yang ditambahkan ke tabel berisi
  data akan memvalidasi baris lama, dan di sini tidak ada baris lama.
- DDL kedua berkas di-grep lebih dulu: nol `DROP`, nol `UPDATE`, nol
  `TRUNCATE`. Murni 4 `CREATE TABLE`, kolom baru ber-`DEFAULT`, satu `NOT NULL`
  dilonggarkan, 2 `CHECK`, RLS + policy + trigger.

**Diperiksa SESUDAH apply** — semua cocok persis dengan angka lokal:

```
entity_prefix        37 → 39   (SCR, ADL)
relasi public       140 → 144  (screening_run, ads_decision_log,
                                optimization_tracker, report_benchmark_shopee)
sm_machines            31      (tak berubah — benar, tak ada mesin baru)
notif_events           67      (tak berubah — benar, tak ada event baru)
report_benchmark_shopee  1 baris aktif, versi 1
client_reports         +payload_schema, +benchmark_versi_shopee,
                       benchmark_versi jadi NULLABLE, 2 CHECK baru
RLS                    aktif di 4 tabel, 3 policy SELECT
trigger                6 terpasang
```

**Yang masih milik pemilik, bukan kode:** UAT ini berhenti di "laporan terbentuk
& angkanya benar". Belum ada laporan Shopee di live, dan belum ada satu pun
laporan yang diterbitkan lalu dibaca kontak klien sungguhan.

### Tiga keputusan pemilik yang MUNCUL dari UAT

Laporan lengkap: **`docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`**. Ringkas:

- **SHP-1 🔴 GMV mana yang dilaporkan** — engine memakai "Pesanan Dibuat"
  (Rp 1.624.937.476), yang memuat Rp 383,9 juta (23,6%) pesanan batal + retur.
  "Pesanan Dibayar" (Rp 1.329.227.354) ada di berkas tapi **tidak diparse sama
  sekali**. `gmv_net` adalah penulis tunggal `clients.total_sales` → Health
  Score M13, jadi ini menggerakkan skor, bukan cuma tampilan.
- **SHP-2 🟡 label KRITIS** — skor 5,7 (<6) padahal ROAS 9,63× dan ketiga flag
  iklan hijau. Penariknya batal 20,5% dan Live Streaming. Isinya jujur;
  pertanyaannya kata yang dibaca klien.
- **SHP-3 🟡 instruksi kerja AM** — deteksi otomatis pada nama berkas MENTAH
  Seller Centre: 8 benar, **3 salah slot**, 4 tak terdeteksi. Salah slot tidak
  meninggalkan jejak di laporan. Sampai pengenalan nama mentah ditambahkan ke
  engine, instruksi AM harus **pakai dropdown modul per berkas**, bukan
  mengandalkan "Otomatis".

Ketiganya ada di `DECISIONS.md` tabel Open. **Jangan** memutuskan sendiri di
sesi berikutnya — SHP-1 khususnya mengubah angka yang sudah dilaporkan ke klien.

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
2. **SHP-1 dulu kalau pemilik sudah menjawab** — itu satu-satunya temuan UAT
   yang mengubah ANGKA (GMV yang dilaporkan + `clients.total_sales` → Health
   Score M13). Kalau jawabannya opsi C, kerjanya: parser bagian ke-3
   ("Pesanan Dibayar") di `report/shopee/metrik.ts` → `gmv_kotor` vs `gmv_net`
   diisi angka BERBEDA di `createReportShopee` → renderer menampilkan keduanya.
   Laporan lama tidak bisa dihitung ulang (tabel beku) — hanya laporan baru
   yang ikut aturan baru, dan itu harus dikatakan ke pemilik.
3. **SHP-3 (opsi C)** — tambah pengenalan nama berkas MENTAH Shopee ke
   `report/shopee/detect.ts` sebagai lapisan nama KEDUA, dijalankan setelah
   konvensi tim dan SEBELUM fallback tanda-tangan isi. 14 pola ada di
   `UAT_SHOPEE_FIM_MOTOR_20260903.md` §4.3. Aditif, tapi tetap butuh entri
   `DECISIONS.md` karena menambah aturan yang tidak ada di alat aslinya.
4. **SCR-UI-1** — tanyakan ke Yohan/Nerissa apakah divisi Ads perlu bisa
   me-list klien. Kalau ya, itu rute picker sempit + entri `DECISIONS.md`,
   bukan pelebaran `clients_select` apa adanya.
5. **Sidebar IA v3** (`docs/CDPS_Sidebar_IA_v3.md`) — masih track terpisah dan
   masih butuh keputusan produk untuk 3 pasang halaman yang mungkin duplikat.
   Catatan baru: menu bertambah satu baris sesi ini (`/ads/screening`), jadi
   kalau reorganisasi dikerjakan, hitung ulang dari `nav.ts` yang sekarang.
6. **PR untuk branch ini** — belum dibuat; pemilik belum memintanya. Jangan
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

**UAT export asli:** `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md` — 15
berkas Fim Motor Juli 2026, tabel cek-ulang angka ke berkas mentah, tabel
deteksi per berkas, dan tiga keputusan pemilik SHP-1..SHP-3 dengan hitungan
untung-ruginya.

**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` (baris
Status sudah diperbarui), `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`
(Gelombang 2 & 3 kini bertanda ✅, SC-08 = domain+API, SC-09 = UI).

**Keputusan:** `docs/DECISIONS.md` — baris teratas tabel Decided
("UI Gelombang 2+3 landed"), dan **SCR-UI-1** di tabel Open.

**Handoff rantai (baca yang terbaru dulu):** dokumen ini →
`HANDOFF_ADVERTISER_TOOLS_SC08_20260903.md` →
`HANDOFF_ADVERTISER_TOOLS_G2G3G4_20260903.md`.
