# HANDOFF — sesi 6: Gelombang 4 (TikTok Ads Scanner) SELESAI — AS-01..AS-05

**Tanggal:** 2026-09-03 (sesi lanjutan KEENAM hari yang sama). **BACA INI
DULU.** Rantai sebelumnya masih ada sebagai riwayat tapi sebagian usang:
`HANDOFF_ADVERTISER_TOOLS_UI_20260903.md` →
`…_SC08_20260903.md` → `…_G2G3G4_20260903.md` → **`…_SESI5_20260903.md`**
(masih akurat untuk §2 pola apply migrasi live dan §6 jebakan lingkungan —
dirujuk, tidak diulang di sini).

**Branch:** `claude/baca-handoff-lanjutkan-task-pftmbi`, di atas
`claude/advertiser-tools-consolidation-handoff-96gswr` (PR #278, masih OPEN)
**Pemilik permintaan:** Nerissa (COO) untuk G1–G3; Gelombang 4 di atas
keputusan pemilik O67/O69 (Yohan)

---

## 0. Posisi persis — SALIN KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo / branch** | `MEAgrup/AgencyAPP`, `claude/baca-handoff-lanjutkan-task-pftmbi` — sudah di-push |
| **PR** | Dibuka sesi ini sebagai DRAF, base `main`. **BERTUMPUK di atas PR #278** — lihat §5. **Jangan merge sendiri.** |
| **Rencana 4 gelombang** | G1 ✅ · G2 ✅ · G3 ✅ (ketiganya kode + UI + migrasi di live) · **G4 ✅ SELESAI di sisi kode (AS-01..AS-05, termasuk UI `/ads/scanner`)** — migrasinya belum di live |
| **Live `CDPS SG`** | ⚠️ **TERTINGGAL SATU MIGRASI** dari branch ini: `20260910010000_gelombang4_adsscanner.sql` **BELUM diterapkan**. Live masih 143 tabel / prefix 39. Lokal: 145 / 40. |
| **Keputusan pemilik terbuka** | **NOL** untuk Gelombang 1–4. Sisa: **SCR-UI-1** (nice-to-have) + **O65** (ledger migrasi live, lama terbuka) |
| **⚠️ Yang masih belum pernah terjadi** | Belum ada satu laporan pun (TikTok/Shopee) yang **diterbitkan lalu dibaca kontak klien sungguhan**. Aksi pemilik/AM, bukan sesi Claude. Ads Scanner juga belum pernah kena export TikTok ASLI. |

---

## 1. Yang landed sesi ini — tiga commit

| Commit | Isi |
|---|---|
| `2e18153` | **AS-01..AS-04** — migrasi `20260910010000` + domain + 6 rute + tipe FE |
| `4f12b89` | handoff (dokumen ini) |
| `4a9b662` | **AS-05** — UI `/ads/scanner` (portofolio, scan baru, hasil) + `adsscanner-ui.ts` + baris nav |

**AS-01 dan AS-03 sudah terpenuhi SEBELUM sesi ini** dan tidak perlu diputus
lagi — O67 memilih jalur (b) PORT PENUH, dan engine
`packages/core/src/adsscanner/tiktok/` sudah mengikuti bentuk `report/`. Yang
dikerjakan sesi ini adalah **lapisan penyimpanan** yang O67 sengaja tunda.
Backlog `AS-01..AS-04` sekarang ✅ dengan penjelasan per baris. **AS-05 (UI)
lahir sebagai tiket baru di sesi ini DAN langsung dikerjakan** (commit
`4a9b662`, §1.6) — jadi Gelombang 4 tidak menyisakan tiket kode.

### 1.1 Migrasi `20260910010000` — dua tabel

| Tabel | Isi |
|---|---|
| `adsscanner_run` (**ASR-**) | satu baris per scan mingguan satu klien. Input jadi kolom: `kategori`, `mode`, `minggu_mulai`; sisa `AdsScannerConfig` (8 field, termasuk `blacklist` array) di `konfigurasi` jsonb; hasil di `payload` jsonb; provenance di `sumber_berkas` |
| `adsscanner_benchmark` | kategori→`{roi,tr,gpm}` berversi/append-only, **34 kategori**, versi 1 = `ADSSCANNER_BENCH_V1` apa adanya. Pola identik `report_benchmark_shopee` |

`entity_prefix` 39→40 (ASR), dinaikkan bersama `PREFIXES` di `ident.ts` pada
commit yang SAMA. Gate hitungan dinaikkan di **`scripts/db-rebuild.sh` DAN
`.github/workflows/ci.yml`** sekaligus (145 tabel, 40 prefix) — dua gerbang
untuk angka yang sama, menaikkan salah satu saja = lokal hijau, CI merah.

### 1.2 Tiga keputusan bentuk yang jangan dibongkar tanpa alasan baru

**(a) SELURUH baris beku, bukan cuma `payload`.** Trigger `forbid_mutation` di
UPDATE **dan** DELETE. Tidak ada konsep "edit satu scan" di alat aslinya —
input berubah berarti scan BARU. Ada test untuk ketiga jalur mutasi.

**(b) SATU prefix, bukan dua seperti Gelombang 3.** Satu-satunya entitas ber-ID
di sini adalah RUN-nya; benchmark berkunci `versi integer`.

**(c) Tiga input dinaikkan jadi kolom nyata, sisanya jsonb.** `kategori`
(memilih baris benchmark), `mode` (di-CHECK), `minggu_mulai` (di-index untuk
portofolio). Sama seperti `screening_run` menaikkan `target_roas` tapi tidak
setiap ambang R04.

### 1.3 Kenapa BUKAN `client_reports` — dan kenapa ini penting untuk dibaca

O69 sudah memutuskan "tabel CDPS baru", tapi alasannya perlu diketahui supaya
tidak "dirapikan" nanti. Tiga alasan yang **berdiri sendiri** (lengkap di header
migrasi):

1. Baris `client_reports` punya **permukaan Client Portal**
   (`client_report_publikasi` + `GET /client-portal/reports/{id}/html`).
   Scan Ads Scanner adalah **strategi bidding internal** — SKU mana di-scale,
   mana dimatikan, budget dipindah ke mana. Menaruhnya di sana berarti satu
   kelalaian gerbang publikasi = catatan kerja advertiser terkirim ke klien.
2. Read pattern-nya **portofolio lintas klien** (satu advertiser pegang banyak
   toko — `state.clients` di alat asli), yang `client_reports` tidak punya.
3. `client_reports.payload_schema` sudah dikunci CHECK ke DUA nilai dan kolom
   benchmark-nya sudah dua dengan CHECK "tepat satu terisi". Mesin ketiga di
   sana berarti kolom benchmark ketiga dan CHECK tiga cabang, untuk baris yang
   tidak berbagi satu pun konsumen dengan dua yang lain.

**Konsekuensi yang disengaja:** nol rute portal ke `adsscanner_run`, juga tidak
sebagai stub. Ini **membalik** satu kalimat plan §7 ("insight editable + portal
klien langsung berlaku kalau outputnya masuk `client_reports`") — §7 sudah
diberi blockquote status yang mencatat pembalikan itu, bukan dibiarkan
menyesatkan.

### 1.4 Dua gerbang yang SENGAJA menolak, bukan mendegradasi diam-diam

**Kategori tak dikenali → 400.** Kalau diloloskan, `benchOf` mengembalikan baris
all-null dan `skor.ts` dengan BENAR menormalisasi ulang atas komponen yang
tersedia — hasilnya skor yang **TAMPAK sebanding** antar klien tapi diam-diam
kehilangan komponen ROI dan GPM. Itu keluaran terburuk yang tersedia (angka
yang kelihatan bisa dibandingkan padahal tidak). Di alat aslinya kategori ngawur
tidak pernah mungkin (dropdown); begitu jadi API, ia mungkin. **Jangan** ubah ini
jadi fallback diam-diam — kelas bug yang sama dengan alasan `metrik.ts` menolak
`||0` untuk CTR/CTOR.

**Slot `analitik` wajib → 400.** Semesta SKU dibangun eksklusif dari Analitik
Produk (`metrik.ts:buildSkuBase`). Tanpa itu setiap baris ads jadi "orphan
spend" dan scan melaporkan **nol SKU sambil menjawab 201**. Pola pre-check yang
sama dengan `MSG_BISNIS_HOME_WAJIB` di `report.ts`.

Selain itu: **tanggal minggu yang tak terbaca DITOLAK**, bukan disimpan sebagai
scan tanpa periode (`weekStartMonday` mengembalikan null untuk sampah, yang
kalau diloloskan jadi `minggu_mulai` null diam-diam). Field-nya sendiri tetap
opsional — hanya sampah yang ditolak.

### 1.5 Rute (6) + tipe FE

```
POST /api/v1/clients/{id}/adsscanner/scan        → jalankan & simpan satu scan
GET  /api/v1/clients/{id}/adsscanner/runs        → riwayat satu klien
GET  /api/v1/adsscanner/runs/{id}                → satu scan penuh
GET  /api/v1/adsscanner/runs/{id}/html           → render payload BEKU
GET  /api/v1/adsscanner/portfolio                → baris terakhir per klien
GET  /api/v1/adsscanner/categories               → kategori benchmark AKTIF
```

`/html` **sengaja tanpa `mode=klien|internal`** (beda dari `/reports/{id}/html`):
scan ini internal ujung ke ujung, jadi tidak ada varian aman-untuk-klien untuk
ditawarkan. Menambah mode klien adalah keputusan produk, bukan flag render.

`GET /adsscanner/categories` melayani dari **baris benchmark AKTIF**, bukan dari
konstanta `ALL_ADSSCANNER_CATEGORIES` — keduanya cocok hari ini (34), tapi v2
yang dikalibrasi ulang bisa menambah/mengubah nama, dan picker yang menawarkan
kategori di luar benchmark aktif menawarkan persis nilai yang `runAdsScan` tolak.

`web-internal/src/lib/adsscanner.ts`: tipe wire + `parseAdsScanExport` +
`canUseAdsScanner`/`canRunAdsScan`, plus pembaca payload beku
(`readAdsScanPayload`/`readAdsScanBerkas`). Dipakai halaman `/ads/scanner`
(§1.6) — pada commit `2e18153` ia sengaja masih tanpa halaman, pola bertahap
yang sama seperti SH-01..SH-05 (sebelum SH-07) dan SC-08 (sebelum SC-09).

> **Beda halus dari `parseSkuWorkbook` (G3), jangan "diseragamkan":**
> `parseSkuWorkbook` mengirim SELURUH sheet **beserta namanya** karena server
> memilih sheet performa berdasarkan NAMA (A02). `parseAdsScanExport` mengirim
> **sheet pertama saja** karena keempat export ini ditentukan oleh **baris
> header persis** (`FILE_SIGS`: analitik row 3, ads row 0, video row 2, adslive
> row 0) — tidak ada nama untuk dipilih, dan indeks baris hanya bermakna di
> dalam satu AoA.

### 1.6 UI (AS-05) — `/ads/scanner`, tiga layar

| Layar | Isi |
|---|---|
| **Portofolio** (tab DEFAULT) | scan TERAKHIR tiap klien + vonis + rollup, diurut dari **pool realokasi terbesar** |
| **Scan baru** | kategori (dari benchmark AKTIF), minggu, mode, unggah 4 export sekaligus + override paksa-slot & tukar jenis video per berkas |
| **Hasil scan** | KPI, realokasi, SKU **dikelompokkan per bucket**, SKU mati, tabel angle, provenance berkas |

**Empat keputusan tampilan yang jangan dibongkar tanpa alasan baru:**

1. **Portofolio top-level & default, BUKAN tab di halaman satu klien.** Ia
   justru read pattern yang JADI ALASAN O69 memilih tabel sendiri —
   menguburnya sebagai sub-tab membatalkan alasan tabel itu ada. Diurut dari
   pool realokasi karena pool ITU jumlah budget yang sekarang jatuh ke SKU
   tak layak: proksi urgensi terdekat yang daftar itu punya.
2. **SKU dikelompokkan per BUCKET, bukan diurutkan per skor.** Skor adalah
   INPUT ke bucket; dua SKU berskor sama bisa butuh aksi berlawanan (satu
   punya konten tanpa belanja, satu belanja tanpa konten). Bucket-nya ADALAH
   enam aksi itu. `BUCKET_ORDER` menaruh uang yang BOCOR dulu (BOROS, PERLU
   OPTIMASI) baru peluang (SCALE UP).
3. **`adsscanner-ui.ts` modul TERPISAH dari `skuscreener-ui.ts`** — lihat
   jebakan §4.5. Bukan duplikasi yang lupa dirapikan; unitnya berlawanan.
4. **Baris nav terpisah dari "Screening SKU".** Dua pertanyaan berbeda di dua
   titik funnel, dua export, dua tabel. Satu entri menu akan menyembunyikan
   yang tidak dibuka lebih dulu.

**Yang TIDAK berubah:** halaman nol perhitungan (unggahan didekode + di-hash,
sisanya server; tabel membaca payload beku), dan **ID klien tetap KOLOM**
(SCR-UI-1 masih terbuka). Portofolio meringankan gejalanya tanpa melebarkan
RLS: ia mendaftar klien yang SUDAH punya scan dengan tombol "scan baru" yang
mengisi kolomnya, jadi mengetik ID hanya perlu untuk scan PERTAMA satu klien.

---

## 2. Migrasi live — BELUM diterapkan, dan itu pekerjaan berikutnya

`20260910010000_gelombang4_adsscanner.sql` **hanya diverifikasi lokal**
(`db-rebuild.sh`). Live `CDPS SG` masih 143 tabel / prefix 39.

**Pakai pola empat langkah `HANDOFF_..._SESI5_20260903.md` §2** — jangan
mengarang ulang: (1) diff daftar relasi live vs lokal-pra-migrasi DUA ARAH, nol
drift baru boleh apply; (2) cek tabel yang kena `ADD CONSTRAINT`; (3) grep DDL
lebih dulu; (4) sesudah apply cocokkan gate hitungan (prefix 40, relasi, mesin
31, notif 67, RLS, trigger).

**Lewat `mcp__Supabase__apply_migration`, BUKAN `supabase db push` (O65).**

Dua hal yang memudahkan apply ini dibanding yang sebelumnya:

- Migrasi ini **murni CREATE + INSERT**. Nol `DROP`/`UPDATE`/`TRUNCATE`
  (sudah di-grep), nol `ALTER TABLE` pada tabel yang sudah ada — jadi tidak ada
  baris lama yang perlu lolos constraint baru.
- Satu-satunya sentuhan ke tabel lama adalah `INSERT INTO entity_prefix` satu
  baris.

⚠️ **Berkas migrasi ini TIDAK memuat komentar "NOT applied to live"** — sengaja,
karena peninggalan komentar seperti itu di `20260908050000` sempat jadi salah
setelah diterapkan. Kenyataannya dicatat di sini dan di `DECISIONS.md` saja.

---

## 3. Verifikasi — jalankan ulang, jangan percaya baris ini

```bash
service postgresql start                       # container restart mematikannya
su postgres -c "psql -c \"alter user postgres password 'postgres'\""
npm ci                                         # root (apps/* + packages/*)
cd web-internal && npm ci && cd ..             # TERPISAH — bukan workspace root!
bash scripts/db-rebuild.sh --yes
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test --workspaces --if-present
npm run typecheck --workspaces && npm run lint -w @cdps/api -- --max-warnings 0
cd web-internal && npm run typecheck && npm test && npm run build
```

Hasil di DB **fresh** akhir sesi ini:

```
db-rebuild    172 migrasi · 145 tabel · entity_prefix 40 · 4 invariant SQL LOLOS
@cdps/core    530/530     (nol perubahan — hanya ralat docstring 33→34 kategori)
@cdps/db      53/53
@cdps/domain  1801/1 skip (dari 1765 — +36 test adsscanner)
@cdps/api     398/398     (nol perubahan — parity guard tetap hijau)
web-internal  506/506 (dari 487 — +19 test adsscanner-ui) · build hijau
typecheck     4 workspace + web-internal bersih
eslint        @cdps/api --max-warnings 0 bersih
```

**Dua gerbang paritas TIDAK dipercaya hijau begitu saja** (jebakan §6.3 SESI5):

- `route-parity` diprobe LANGSUNG lewat `vite-node` memanggil
  `feCalls()`/`servedBy()`: **5 panggilan FE baru, kelimanya SERVED**; 6 rute
  adsscanner terdaftar (yang ke-6, `/html`, dipakai lewat `adsScanHtmlPath`
  sebagai string path, bukan `api.get` — jadi memang bukan "call"). Totals:
  421 rute / 406 panggilan FE. `KNOWN_GAPS` tetap **kosong**.
- `shape-parity` **diuji-negatif**: menambah `bogus_probe_field` ke
  `AdsScanPortfolioRowWire` benar-benar membuatnya MERAH dengan pesan yang
  menyebut nama tipenya, lalu dikembalikan. Jadi ketiga tipe baru memang
  diawasi, bukan lolos karena tak terlihat.

---

## 4. Enam jebakan BARU sesi ini (di luar 7 jebakan SESI5 §6, yang semuanya masih berlaku)

1. **`normId` memotong ID ke 15 digit pertama — fixture test WAJIB berbeda di
   dalam 15 digit itu.** Dua ID fixture saya (`…462601638` dan `…462609999`)
   berbeda di digit ke-16, jadi keduanya menjadi kunci join yang SAMA: SKU kedua
   menimpa yang pertama, belanja ads mendarat di produk yang salah, dan test
   gagal dengan cara yang terbaca seperti bug engine. Ini bukan bug — itu
   perilaku `normId` yang disengaja (export memotong presisi). Bikin ID fixture
   berbeda di digit AWAL.
2. **`audit_log` immutable — JANGAN `delete from audit_log` di `afterEach`.**
   Percobaan bersih-bersih saya memicu `audit_log is append-only/immutable:
   DELETE forbidden` di SETIAP test, menutupi semua kegagalan asli. Baris audit
   test memang menumpuk; itu benar dan bukan masalah.
3. **OD dan Director adalah FLAG di `permission.makeRole({od:true})` /
   `{director:true}`, BUKAN `level`.** `makeRole({level:'director'})` menghasilkan
   aktor yang bukan Director sama sekali dan gagal dengan "expected false to be
   true". `Actor` juga membawa `divisi` di samping `role`.
4. **Suite `@cdps/domain` HANYA hijau di DB yang baru `db-rebuild.sh`, sekali.**
   `admin.test.ts` ("hari libur") dan `client.test.ts` ("Hold Service two-step")
   menghitung baris `audit_log`/notifikasi milik mereka sendiri dengan `toBe(1)`,
   tapi `audit_log` immutable sehingga cleanup mereka tidak bisa menghapusnya.
   Jalankan suite domain dua kali tanpa rebuild ⇒ keduanya merah dengan
   `expected 7 to be 1` (angkanya = berapa kali Anda menjalankannya).
   **Pre-existing, bukan dari Gelombang 4** — tapi ia akan membuat Anda mengira
   diff Anda merusak sesuatu. Rebuild dulu sebelum percaya kegagalan di dua berkas
   itu. Semua angka test di §3 diukur pada rebuild bersih.
5. **Persentase payload Ads Scanner adalah FRAKSI, payload SKU Screener
   percent-NUMBER.** `0.05` vs `2.0` untuk hal yang sama. Karena itu
   `adsscanner-ui.ts:fmtPct` MENGALIKAN 100 dan `skuscreener-ui.ts:fmtPct` TIDAK.
   Jangan "rapikan" keduanya jadi satu formatter generik — mode gagalnya bukan
   crash, tapi CTR 5% yang terbaca `0,05%` atau `500%`. Ada test yang memaku kedua
   arah.
6. **`JsonParam` bukan export `@cdps/db`** — ia alias LOKAL di `report.ts`
   (`Parameters<TransactionSql['json']>[0]`). Interface TS tidak memenuhi index
   signature `JSONValue`, jadi payload/config perlu
   `as unknown as JsonParam` dengan alias yang dideklarasikan sendiri per modul.

---

## 5. PR — BERTUMPUK, baca sebelum menilai CI

PR sesi ini dibuka **draf**, base `main`, TAPI branch-nya dicabang dari
`claude/advertiser-tools-consolidation-handoff-96gswr` (**PR #278, masih
OPEN**). Jadi diff-nya memuat **6 commit PR #278 + 3 commit sesi ini** sampai
#278 merge; sesudah itu ia mengecil sendiri jadi tiga commit.

Ini pola bertumpuk yang sama seperti PR #277 di atas #276 (dicatat di
`HANDOFF_..._G2G3G4`). **Urutan merge: #278 dulu, baru PR sesi ini.** Merge
adalah keputusan pemilik — jangan merge atas inisiatif sendiri.

---

## 6. Urutan kerja yang disarankan untuk sesi berikutnya

> ### ⚠️ RALAT versi pertama handoff ini
> Versi pertama menaruh "terapkan migrasi ke live" sebagai langkah #1. **Itu keliru
> urutannya.** Sesi 5 menerapkan migrasi G2+G3 ke live **setelah** PR #276/#277
> MERGE. Migrasi Gelombang 4 ada di PR **draf** yang **bertumpuk di atas #278 yang
> juga belum merge** — menerapkannya sekarang membuat skema produksi mendahului
> `main` dengan isi yang belum direview, dan `adsscanner_run` beku/append-only by
> design sehingga jalan mundurnya tidak bersih. **Live menunggu merge**, dan itu
> keputusan pemilik, bukan pekerjaan yang bisa diambil sesi berikutnya.

1. **UAT Ads Scanner dengan export TikTok Shop ASLI.** Sekarang jalur terbesar yang
   tersisa, dan yang paling mungkin memunculkan temuan nyata. Sisi TikTok belum
   pernah kena data sungguhan **untuk dua mesin sekaligus** (laporan TikTok dan
   Ads Scanner). UAT Shopee yang setara memunculkan SHP-1 (GMV kotor=bersih) dan
   SHP-3 (3 berkas salah slot) — dua bug yang tidak satu pun test sintetis
   menangkap. Butuh berkas dari pemilik/AM.
2. **Verifikasi temuan O67 bersamaan dengan UAT itu:** filter blocker status produk
   `!/aktif/i.test(status)` adalah substring polos tanpa batas kata, jadi
   "Nonaktif"/"Dinonaktifkan" (bentuk NEGASI, sama-sama mengandung "aktif") terbaca
   AKTIF dan tidak diblokir. **Diport apa adanya dengan komentar peringatan** —
   sekarang ia bisa jalan di produksi. Cek terhadap string status asli Seller
   Center; kalau benar salah, perbaikannya kecil (batas kata) tapi mengubah bucket
   `DIBLOKIR`, jadi butuh entri `DECISIONS.md` karena menyimpang dari port setia.
   Sama halnya `adslive`: slot diterima tapi tidak diskor, menunggu keputusan
   apakah Ads Live layak jadi komponen skor.
3. **Setelah #278 dan PR sesi ini merge: terapkan `20260910010000` ke live** (§2).
   Pola empat langkah + `apply_migration` (BUKAN `db push`, O65).
4. **UAT lain yang masih milik pemilik/AM** (bukan kode): (a) terbitkan satu laporan
   ke kontak klien sungguhan dan pastikan terbaca di portal; (b) uji atribusi `MTR-`
   dengan klien yang PUNYA kampanye `Shopee Ads` aktif.
5. **SCR-UI-1** (Ads perlu me-LIST klien?) — tidak blocking, tapi sekarang relevan
   untuk DUA halaman (`/ads/screening` dan `/ads/scanner`), jadi menjawabnya sekali
   menguntungkan keduanya. Portofolio Ads Scanner sudah meringankan gejalanya tanpa
   melebarkan RLS (tombol "scan baru" per klien yang sudah punya scan), jadi
   urgensinya turun, bukan hilang.
6. **Tiket kosmetik kecil** kalau ada waktu: kelas badge di `ReportPanel`
   (SESI5 §6.6), lint `admin/employees` (SESI5 §6.5).

## 7. Peta berkas

**Migrasi:** `supabase/migrations/20260910010000_gelombang4_adsscanner.sql`
(header-nya memuat rationale "kenapa bukan client_reports" dan "kenapa
`konfigurasi` jsonb bukan 11 kolom" — baca sebelum mengubah bentuknya).

**Domain:** `packages/domain/src/adsscanner.ts` (`runAdsScan`,
`getAdsScanRun`, `listAdsScanRuns`, `adsScanPortfolio`, `renderAdsScanHtml`,
`adsScanCategories`), didaftarkan di `packages/domain/src/index.ts`.

**Test:** `packages/domain/src/adsscanner.domain.test.ts` (36 test, namespace
`ZZAS-`). Math engine-nya TIDAK diulang di sini — itu sudah 30 test di
`packages/core/src/adsscanner/tiktok/adsscanner.test.ts`. Yang diuji di sini:
deteksi 4 slot + kedua gerbang penolak, immutability (UPDATE/DELETE keduanya),
izin per peran termasuk OD/Director berlapis, **recompute-from-payload**
(re-skor dari `benchmark_versi` yang direkam ulang menghasilkan skor/bucket/gate
identik), dan row-scope portofolio.

**Rute:** `apps/api/src/app/api/v1/adsscanner/**` (4) +
`apps/api/src/app/api/v1/clients/[id]/adsscanner/**` (2).
Wire: `apps/api/src/lib/wire.ts` (`adsScanRunSummaryToWire`,
`adsScanRunDetailToWire`, `adsScanPortfolioRowToWire`).

**FE:** `web-internal/src/lib/adsscanner.ts` (tipe wire + pembaca payload + fetch +
gate), `web-internal/src/lib/adsscanner-ui.ts` (+ `.test.ts`, 19 test — pemaku unit
fraksi-vs-percent), `web-internal/src/components/adsscanner/PortfolioTable.tsx` dan
`ScanResultView.tsx`, halaman `web-internal/src/app/(shell)/ads/scanner/page.tsx`,
baris nav di `web-internal/src/lib/nav.ts`. Didaftarkan di `shape-parity.test.ts` **dua tempat**: `WIRE_TO_FE`
map DAN `FE_FILES` array (jebakan SESI5 §6.4).

**Prefix:** `packages/core/src/ident.ts` (`ASR`), dan gate hitungan di
`scripts/db-rebuild.sh` + `.github/workflows/ci.yml`.

**Rencana & backlog:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` (§7 kini
punya blockquote status yang mencatat dua premisnya yang kedaluwarsa dan satu
poinnya yang TERBALIK), `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`
(AS-01..AS-04 ✅ per baris, **AS-05 UI** baru).

**Keputusan:** `docs/DECISIONS.md` — baris Gelombang 4 di paling atas tabel
Decided, delapan sub-keputusan (a)–(h) plus daftar "yang TIDAK dikerjakan"
eksplisit.
