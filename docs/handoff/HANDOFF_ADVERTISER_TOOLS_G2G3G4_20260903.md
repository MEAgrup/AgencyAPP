# HANDOFF — Konsolidasi Alat Advertiser: Gelombang 2, 3, 4 (engine `packages/core`) landed

**Tanggal:** 2026-09-03
**Branch:** `claude/advertiser-tools-consolidation-waves-6tl68h` (sudah di-push, PR belum dibuat — tidak diminta)
**Pemilik permintaan:** Yohan (Director) via Nerissa (COO)
**Rencana penuh:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md`

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch kerja** | `claude/advertiser-tools-consolidation-waves-6tl68h` — sudah di-push ke origin, tidak ada PR (belum diminta pemilik) |
| **Bukan branch PR #276** | PR #276 (`claude/cdps-advertiser-tools-consolidation-xxpzow`, Gelombang 1) masih **draft terpisah, belum di-review/di-merge pemilik**. Branch kita bercabang dari sana (sudah membawa seluruh histori Gelombang 1) tapi Gelombang 2/3/4 di bawah ini HANYA ada di branch kita, BUKAN di PR #276. |
| **Migrasi baru** | 3 migrasi, SEMUA LOKAL SAJA — **BELUM diterapkan ke live** (`CDPS SG`, project id `egddxfcnrtecheiykhlf`): `20260908050000_gelombang3_sku_screener.sql`, `20260909010000_sh01_shopee_report_engine.sql`. (Gelombang 4 nol migrasi — lihat §1.3.) |
| **Gerbang hitungan (lokal, terverifikasi)** | tabel **143** · `entity_prefix` **39** (37→39, +`SCR-`/+`ADL-`) · `sm_machines` **31** (tak berubah) · `notif_events` **67** (tak berubah) — sudah dinaikkan di `scripts/db-rebuild.sh` **DAN** `.github/workflows/ci.yml` di commit yang sama (aturan rumah, lihat §4 poin 2) |
| **Status suite (lokal, dijalankan ulang independen — bukan cuma laporan agent)** | `core` **500/500** · `db` **53/53** · `domain` **1716 lulus/1 skip** (nol regresi) · `api` **398/398** · `web-internal` **441/441** · typecheck 4 workspace backend + web-internal bersih |
| **Postgres lokal** | `service postgresql start` lalu `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"`. Jalankan `scripts/db-rebuild.sh --yes` dulu sebelum test apa pun butuh DB. |
| **Perubahan kecil tak terkait, juga landed di branch ini** | Label grup sidebar "Alat" → **"AI Tools MEA"** (`web-internal/src/lib/nav.ts`) — permintaan terpisah Nerissa. Reorganisasi sidebar v3 yang JAUH lebih besar **BELUM dikerjakan** — lihat §5. |

---

## 1. Yang sudah landed sesi ini (Gelombang 2, 3, 4 — engine `packages/core` murni)

Dikerjakan lewat **3 agent terisolasi paralel** (worktree terpisah), masing-masing **diverifikasi ulang independen** (bukan diterima mentah dari laporan agent) sebelum digabung ke branch ini. Urutan landing: Gelombang 4 → Gelombang 3 → Gelombang 2 (Gelombang 2 agent lupa `git commit`, ditemukan & diperbaiki saat verifikasi — lihat §4 poin 1).

### 1.1 Gelombang 2 — Shopee Report Engine (SH-01..SH-05 selesai; SH-06 + domain create-flow + UI belum)

- `packages/core/src/report/shopee/` — cermin persis struktur `packages/core/src/report/` (TikTok): `detect.ts` → `metrik.ts` → `skor.ts` (6 dimensi .22/.22/.18/.14/.12/.12, verbatim dari HTML pemilik) → `insight.ts` → `payload.ts` (`cdps.report.shopee.v1`, **bentuk sama persis** dengan `PayloadInsight` TikTok — nol perubahan di editor insight/Client Portal Gelombang 1) → `render.ts` → `run.ts`.
- Migrasi `20260909010000_sh01_shopee_report_engine.sql`: tabel `report_benchmark_shopee` (SIBLING dari `report_benchmark`, berversi/append-only — BUKAN baris di tabel yang sama, dua bentuk CONFIG tidak sepadan), `client_reports.payload_schema` + `benchmark_versi_shopee` (kolom baru, kanan, tabel beku untuk UPDATE jadi DEFAULT mengisi baris lama gratis).
- `packages/domain/src/report.ts`: `renderReport` memilih renderer dari `payload_schema`.
- **BELUM dikerjakan sengaja:** pipeline upload→parse→insert (`createReport` versi Shopee) — SATU-SATUNYA yang ada baru engine `packages/core` + dispatch render. **Ini prasyarat SH-06** (jalur "tidak upload manual" — Metric Entry `MTR-` dari hasil parse untuk M6D RM-C, **tiket paling bernilai** menurut plan §5 dan permintaan eksplisit Nerissa/Yohan).
- Batas permanen yang perlu diketahui: 7 dari 17 modul Shopee (ads_toko/ads_produk/ads_banner berkolom identik; bisnis_live/promo_diskon/promo_flashsale/layanan_broadcast tanpa tanda tangan) **tidak bisa** dideteksi dari isi berkas — deteksi modul tetap bergantung konvensi nama berkas manual tim (`[bisnis]-Home && Periode && Klien && tanggal.xlsx`). Ini bukan bug, diuji eksplisit sebagai batas.
- `ReportSummary.benchmarkVersi`/`numOf()` akan diam-diam membaca `null` sebagai `0` untuk baris Shopee (dormant sampai ada yang menulis baris begitu) — **siapa pun mengerjakan SH-06 wajib melebarkan DTO ini dulu.**

### 1.2 Gelombang 3 — MEA SKU Screener (SC-01..SC-07 selesai; SC-08 UI + domain wrapper belum)

- `packages/core/src/skuscreener/` — `parse.ts` (R01/R02/R03 + fallback deteksi ala A02/A03/A06), `median.ts` (**R04 lengkap** dengan penurunan ambang iteratif 50% sampai ≥5 SKU atau floor Views≥50/Clicks≥5 — ini **melampaui** HTML v2 pemilik yang cuma pakai floor tetap, sengaja, karena R04 aturan bernomor wajib bukan shortcut UI), `route.ts` (R05, 5 rute berurutan), `cpc.ts` (R06 CPC Maksimum + anti-rule bertanda terpisah dari PARKIR biasa), `roas.ts` (target manual, default **4** — bukan 3,57 PRD, sesuai `DECISIONS.md` O66; R07/R08 ada sebagai fungsi murni bertes tapi **sengaja tidak dikaitkan** ke default/auto-fill mana pun), `compare.ts` (R09–R12).
- Migrasi `20260908050000_gelombang3_sku_screener.sql`: prefix baru `SCR-` (screening run, Modul A+B lewat kolom `jenis`) dan `ADL-` (Ads Decision Log Modul C, append-only R13-R16) + `optimization_tracker` (anak `screening_run`, PK `(screening_id, product_code)`, nol prefix sendiri).
- `entity_prefix` 37→39 di **tiga** tempat: tabel `entity_prefix`, `PREFIXES` di `packages/core/src/ident.ts`, `docs/DATA_MODEL.md`.
- **BELUM dikerjakan sengaja:** `packages/domain/src/skuscreener.ts` (verbs: `runScreening`, `runCompare`, `logDecision`, `upsertTrackerRow`), route API, dan SC-08 (`web-internal/src/app/(shell)/ads/screening/`).
- **O68 terbuka** (lihat §2) — model 2-baris untuk `ads_decision_log` follow-up 7 hari perlu dikonfirmasi pemilik sebelum domain layer menulis ke sana.

### 1.3 Gelombang 4 — TikTok Ads Scanner (engine murni selesai; NOL migrasi/domain/route — sengaja)

- `packages/core/src/adsscanner/tiktok/` — cermin bentuk yang sama (`detect→metrik→skor→insight→payload→render→run`), payload `cdps.adsscanner.tiktok.v1`. Skor SKU 5-komponen (konten 35%, GMV 25%, efisiensi ROI 20%, CTR 10%, CTOR 10%) dengan komponen tanpa data dibiarkan `null` dan skor dinormalisasi ulang atas komponen yang tersedia (pola sama `baseline/skor.ts`, bukan `||0` seperti alat asli). Benchmark 34 kategori jadi tabel berversi.
- **NOL migrasi/domain/route** — lapisan portofolio multi-klien (`localStorage` di alat asli) **sengaja belum disentuh**, ini **O69 terbuka** (§2), keputusan arsitektur yang harus diambil SEBELUM domain/DB layer alat ini mulai dikerjakan.
- Bug ditemukan di alat ASLI pemilik, **diport apa adanya + komentar peringatan** (bukan diperbaiki diam-diam): filter status produk `!/aktif/i.test(status)` — substring polos, jadi "Nonaktif"/"Dinonaktifkan" (bentuk NEGASI) kebaca aktif. Perlu diverifikasi terhadap string status asli TikTok Seller Center sebelum dipakai produksi (kelas temuan sama dengan A01/A04 — butuh data ekspor nyata, bukan tebakan).

---

## 2. Keputusan terbuka — perlu Yohan (lengkap di `docs/DECISIONS.md`)

| # | Ringkas | Memblokir |
|---|---|---|
| **O68** | `ads_decision_log` (Modul C): append-only (R13) vs Flow C3 PRD ("isi Verdict + GMV 7 hari setelah 7 hari" — kedengarannya edit baris yang sama). Kita pilih baris follow-up BARU (`momen='review_7_hari'`) demi menjaga append-only — PRD sendiri tidak eksplisit soal pola 2-baris ini. | Domain/UI Modul C (bukan kode yang sudah ada — skema sudah dipilih & dites) |
| **O69** | TikTok Ads Scanner: portofolio multi-klien `localStorage` alat asli — jadi tabel CDPS baru, dipetakan ke `clients`/`client_reports` yang sudah ada, atau tidak diport (sekali-jalan tanpa riwayat)? | Domain/DB layer Ads Scanner (engine `packages/core` tidak terpengaruh, sudah siap pakai) |

Sudah RESOLVED sesi ini (jangan tanya ulang): **O66** (default Target ROAS = 4, manual, R07/R08 tidak diotomasi) dan **O67** (Ads Scanner di-port penuh, bukan embed).

---

## 3. Verifikasi cepat sebelum lanjut kerja

```bash
service postgresql start
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes    # harus: 171 migrasi, tabel 143, entity_prefix 39, 4 invariant lolos
npm test -w @cdps/core              # 500/500
npm test -w @cdps/db                # 53/53
npm test -w @cdps/domain            # 1716 lulus / 1 skip
npm test -w @cdps/api               # 398/398
npm run typecheck --workspaces
cd web-internal && npm test && npx tsc --noEmit   # 441/441, bersih (npm install dulu kalau node_modules belum ada)
```

**Jangan percaya baris di atas** — jalankan ulang. Kalau angkanya beda, sesuatu berubah sejak handoff ini ditulis.

---

## 4. Jebakan yang ditemukan sesi ini — jangan ulangi

1. **Agent di worktree terisolasi bisa lupa `git commit`.** Gelombang 2's agent menyelesaikan semua kerjanya tapi meninggalkannya sebagai *uncommitted working-tree changes* di worktree-nya, lalu (tampaknya) sempat menarik branch terbaru tanpa commit kerjanya sendiri dulu — laporan akhirnya ("140 tabel, core 366") jadi berbasis state LAMA (sebelum Gelombang 3 landed), padahal saat itu Gelombang 3 sudah lebih dulu masuk ke branch utama (142 tabel). **Selalu**: `cd` ke worktree, `git status` + `git log --oneline -3` + `git diff <base-commit-asli> --stat` untuk lihat KEADAAN SEBENARNYA sebelum percaya laporan agent — kalau ada uncommitted changes, commit dulu, verifikasi ISOLASI dulu di basis aslinya, BARU merge.
2. **Dua gerbang hitungan tabel harus naik bersama** (`scripts/db-rebuild.sh` + `.github/workflows/ci.yml`) — dan kalau menggabungkan beberapa gelombang yang masing-masing menghitung dari basis berbeda (Gelombang 3: 139→142; Gelombang 2: 139→140, padahal basis sebenarnya sudah 142), angka akhirnya harus DIHITUNG ULANG manual (142+1=**143**), bukan pilih salah satu laporan agent atau jumlahkan mentah kedua delta dari basis yang berbeda.
3. **`node_modules` tidak ikut ke worktree baru** — `npm install` dulu di tiap worktree sebelum test/typecheck, kalau tidak semua test langsung gagal dengan "vitest: not found".
4. **`DB_NAME=<scratch>` env var** ke `scripts/db-rebuild.sh` bikin DB percobaan terpisah (`cdps_sh2`, dst.) tanpa mengganggu `cdps` lokal yang dipakai kerja lain — pakai ini untuk verifikasi isolasi sebelum merge, baru `db-rebuild.sh` biasa (DB `cdps`) di keadaan akhir gabungan.
5. **`docs/design/README.md` adalah rujukan SATU ARAH** — begitu sebuah tool diport, README-nya dan berkas sumbernya TIDAK dipelihara lagi. Kalau menemukan bug di alat ASLI pemilik (seperti bug status "aktif" §1.3), port apa adanya + komentar, jangan perbaiki diam-diam tanpa data nyata untuk memverifikasi perbaikannya benar.

---

## 5. Sidebar IA v3 — permintaan terpisah, BELUM dikerjakan (kecuali 1 label)

Nerissa mengirim `docs/CDPS_Sidebar_IA_v3.md` (spek IA lengkap, ditulis atas nama Yohan) + `docs/CDPS_Sidebar_IA_v3_mockup.html` (mockup visual statis). Ini **reorganisasi besar** navigasi `web-internal` — 9 grup, 30-33 item, pembubaran grup "Portal" (3 dari 4 halamannya dipindah ke Beranda/Tim/Klien), rename banyak label, dan **3 pasang halaman yang kemungkinan duplikat** (§4 dokumennya) yang perlu keputusan produk SEBELUM implementasi — bukan sekadar rename.

**Yang sudah dikerjakan dari situ:** HANYA label grup "Alat" → **"AI Tools MEA"** (`web-internal/src/lib/nav.ts` baris ~329), sesuai permintaan eksplisit "hanya label alat bantu am ganti jadi AI Tools MEA". Isi grup (`AM - baseline riset`, `AM Co-Pilot`) tidak disentuh — dokumen v3 mengusulkan nama lain untuk keduanya (`Baseline Riset Toko`, `Co-Pilot AM`) tapi itu TIDAK diminta sesi ini.

**Kalau sesi berikutnya diminta lanjutkan reorganisasi penuh:** baca §4 dokumen ("Overlaps to resolve before implementation") dulu dan bawa 3 pertanyaannya ke Nerissa/Yohan SEBELUM menulis kode navigasi baru — jangan pilih sendiri mana yang di-drop antara pasangan yang mungkin duplikat (Kinerja Saya vs Tugas Saya, Kinerja Divisi vs Team Performance, Pantauan Risiko Klien vs Client Health).

---

## 6. Urutan kerja yang disarankan untuk sesi berikutnya

1. **SH-06** (Shopee "tidak upload manual") — nilainya paling tinggi menurut plan & diminta eksplisit. Prasyarat: lebarkan `ReportSummary`/`numOf()` untuk Shopee dulu (§1.1), baru bangun `createReport` versi Shopee + jalur `MTR-` (`entry_method='File Export'`, M8 §9.4) — **BUKAN** menulis `wrr_metrik` langsung (baris `otomatis` UPDATE-blocked, invariant beku).
2. Domain/API wrapper + `web-internal` UI untuk Gelombang 2 & 3 (belum ada sama sekali — semuanya baru `packages/core`).
3. SC-08 UI SKU Screener.
4. Bawa **O68** dan **O69** ke Yohan (lewat Nerissa) — begitu dijawab, lanjut domain/DB layer Modul C (SKU Screener) dan Ads Scanner.
5. Sidebar IA v3 (§5) — track terpisah, tanya dulu apakah Nerissa mau reorganisasi penuh sekarang atau baru sebatas label yang sudah diminta.

---

## 7. Peta berkas (orientasi cepat)

**Sumber porting (arsip, jangan diedit lagi):** `docs/design/{SHOPEE_REPORT_ENGINE,MEA_SKU_SCREENER_v2,TIKTOK_ADS_SCANNER}.html`, `docs/design/PRD_MEA_SKU_SCREENER_v1.0.md`, `docs/design/README.md` (tabel status per berkas).
**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md`.
**Keputusan:** `docs/DECISIONS.md` (cari "O66".."O69" dan entri 2026-09-03).
**Kode Gelombang 2:** `packages/core/src/report/shopee/**`, `supabase/migrations/20260909010000_*.sql`, `packages/domain/src/report.ts` (dispatch), `packages/core/src/index.ts` (`reportShopee`).
**Kode Gelombang 3:** `packages/core/src/skuscreener/**`, `supabase/migrations/20260908050000_*.sql`, `docs/DATA_MODEL.md` (entri `SCR-`/`ADL-`).
**Kode Gelombang 4:** `packages/core/src/adsscanner/tiktok/**`, `packages/core/src/index.ts` (`adsscanner`).
**Sidebar:** `web-internal/src/lib/nav.ts` (baris ~329), `docs/CDPS_Sidebar_IA_v3.md` + `docs/CDPS_Sidebar_IA_v3_mockup.html` (spek reorganisasi penuh, belum dikerjakan).
**Perbaikan keamanan tak terkait langsung tapi landed sesi ini:** `working_days_between` ditutup dari `anon` (migrasi `20260908040000`, `DECISIONS.md` entri sebelum O66).
