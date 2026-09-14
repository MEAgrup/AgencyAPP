# HANDOFF — PDT (Pusat Data Toko) SESI 17 → SESI 18

> **Dibuat 2026-09-14, diperbarui sesi yang sama (modul KEEMPAT ditambahkan).**
> Baca berkas ini sebelum lanjut (rantai: … → sesi 16 → berkas ini;
> `docs/handoff/HANDOFF_PDT_SESI16.md` untuk ringkasan merge PR #368,
> `HANDOFF_PDT_SESI14.md`/`HANDOFF_PDT_SESI15.md` untuk detail teknis modul
> pertama/kedua — TIDAK diulang di sini).

---

## 0. Apa yang terjadi sesi ini

**Modul KETIGA — `pdt_sku_master`.** Rekomendasi sesi 16 (`shopee_live`/
`shopee_video` sebagai kandidat modul KETIGA) **diinvestigasi dulu, bukan
langsung dibangun** (pola yang sudah terbukti perlu setiap sesi) — **keduanya
ternyata BLOCKED**:

1. **`shopee_live`** — kelas blocker SAMA seperti `tt_live`: `kolomDipanen`-nya
   (`Informasi Streaming`, `Waktu Mulai`, `Pengunjung`, `Penjualan`) NOL kolom
   identitas sesi live yang stabil. `Informasi Streaming` adalah judul bebas
   ketikan AM (`detect.test.ts` fixture nyata: `'Live Juli'`), bukan ID
   platform — dua sesi live berjudul sama akan bertabrakan di
   `uq_pdt_fact_content`. Dicatat **Open baru `G1-09-2BII-SHOPEELIVE`**.
2. **`shopee_video`** — dikonfirmasi ULANG masih `UNVERIFIED_SIGNATURE`
   (`modules.ts`), tidak berubah sejak G1-02.

**`pdt_sku_master` dibangun sebagai gantinya** — peringkat "paling berharga"
sesuai `HANDOFF_PDT_SESI16.md` §1 sendiri (prasyarat `shopee_ads_cpc`,
`pdt_fact_sku_period`, dan `sku_id` di modul manapun):

- **Shopee**: `shopee_parent_sku` SENDIRIAN (Rule 18) — `Kode Produk` →
  `platform_product_id`, `Kode Variasi` → `platform_variation_id` (default `''`),
  `SKU Induk` → `seller_sku`. `nama_produk`/`kategori_platform`/
  `harga_satuan_terakhir` SENGAJA `null` — modul ini genuinely tidak membawa
  ketiganya di `kolomDipanen`.
- **TikTok**: `tt_orders` SENDIRIAN — **DEVIASI SADAR dari Rule 18 harfiah**
  (PRD minta digabung `tt_transaction_product`, tapi nol kolom kunci-gabung
  terverifikasi antara `SKU ID` level-varian dan `Product ID` level-produk-induk
  yang diduga; lihat `docs/DECISIONS.md` untuk alasan lengkap).
- **UPSERT sungguhan** (`ON CONFLICT (client_platform_id, platform_product_id,
  platform_variation_id) DO UPDATE`) — field opsional di-`COALESCE` dengan
  nilai lama, `status_listing` selalu `'aktif'` saat SKU terlihat (Rule 19),
  `first_seen_at` HANYA diisi sekali.

**Modul KEEMPAT (sama sesi, sesudah `pdt_sku_master`) — `pdt_fact_creator_period`.**
Dengan `pdt_sku_master` ada, blocker LAMA `G1-09-2BII-ADS-CPC` (`shopee_ads_cpc`
menunggu SKU master) seharusnya terbuka — dicoba dulu sebelum pindah ke modul
lain, dan **ditemukan blocker BARU yang lebih dalam**: `report/shopee/metrik.ts`
`parseAdsCsv` (legacy, satu-satunya pembaca TERVERIFIKASI untuk berkas fisik
`Data+Keseluruhan+Iklan+Shopee-*.csv`, yang SAMA PERSIS dengan `shopee_ads_cpc`)
mengunci baris lewat **`nama iklan`**, BUKAN `Kode Produk` — menyiratkan grain
sebenarnya modul ini mungkin **satu baris PER IKLAN** (satu produk bisa punya
banyak iklan berjalan), bukan satu baris per produk seperti framing sesi lalu
menduga. Memakai `Kode Produk` sebagai `kampanye_id` tanpa verifikasi berisiko
**crash runtime** (unique-violation `uq_pdt_fact_ads`), bukan cuma data salah
diam-diam. `G1-09-2BII-ADS-CPC` **diperbarui** (bukan ditutup) — TETAP terbuka,
butuh sample asli sebelum dibangun.

**`tt_transaction_creator` → `pdt_fact_creator_period` dipilih sebagai
gantinya** — grain barisnya SUDAH per-kreator (`Creator name`), cocok PERSIS
dengan kunci tabel (`client_platform_id, creator_handle, periode`), nol
ambiguitas kelas ads_cpc:

- `Creator name`→`creator_handle` (kunci, skip baris kosong), `GMV dari
  kreator`→`gmv`, `AOV`→`aov`, `CTOR`→`ctor`, `Pesanan teratribusi`→
  `pesanan_teratribusi`, `Video`→`jumlah_video`, `Siaran LIVE`→`jumlah_live`.
- `Tayangan video`/`Perkiraan komisi` (kolom whitelist lain modul ini) SENGAJA
  TIDAK ditulis ke tabel ini — konsumennya Co-Pilot/PX, belum dibangun.
- `gmv_live`/`gmv_video`/`sampel_terkirim` (kolom skema yang ADA) SENGAJA
  `null` — modul ini tidak membawa split live/video, dan `Sampel terkirim`
  bukan bagian `kolomDipanen` modul ini (milik `tt_transaction_product`, grain
  PER PRODUK).
- **Nol filter akun toko sendiri** — legacy `affiliateReport` mengecualikan
  `akunKontenToko` dari daftar kreator, PDT TIDAK mereplikasi filter itu di
  sini (keputusan RENDAH RISIKO, beda dari ads_cpc — kunci unik tabel ini
  tidak bisa kolaps karenanya).
- `ON CONFLICT ... DO UPDATE` sungguhan (bukan delete-then-insert) — kunci
  unik tabel ini tidak pernah punya komponen NULL.

**Kode & tes (kedua modul, sesi yang sama):**
- `packages/core/src/pdt/fakta.ts` — `ekstrakBarisSkuMasterShopeeParentSku`,
  `ekstrakBarisSkuMasterTtOrders`, `ekstrakBarisKreatorTtTransactionCreator`
  (fungsi murni).
- `packages/domain/src/pdt.ts` `commitUploadBatch` — blok UPSERT `pdt_sku_master`
  + blok `ON CONFLICT DO UPDATE` `pdt_fact_creator_period`, keduanya sebelum
  `insertAudit`.
- `packages/core/src/pdt/fakta.test.ts` — 34 tes total (19 lama + 10 sku_master
  + 5 creator_period, murni tanpa DB).
- `packages/domain/src/pdt.test.ts` — 76 tes total (67 lama + 6 sku_master + 3
  creator_period, `describeDb`, perlu `DATABASE_URL`). `afterEach` ditambah
  pembersihan `pdt_sku_master` DAN `pdt_fact_creator_period` (FK ke
  `client_platforms` tanpa `ON DELETE CASCADE`).

**Verifikasi (lingkungan sesi ini kosong `node_modules`/DB — keduanya
disiapkan dari nol):**
- `npm install` di root (421 paket).
- Local Postgres 16 cluster (`pg_ctlcluster 16 main start`) + `scripts/db-rebuild.sh
  --yes` — 232 migrasi, seluruh gate lolos. **Nol migrasi baru sesi ini.**
  ⚠️ Cluster sempat mati sendiri di tengah sesi (`pg_lsclusters` → `down`) —
  kalau kena lagi, ulangi: `pg_ctlcluster 16 main start` → `su postgres -c
  "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""` →
  `scripts/db-rebuild.sh --yes` (password perlu di-set ulang tiap restart
  cluster, tidak persisten).
- `npm run typecheck --workspaces` — bersih (4 paket).
- `npm run test -w @cdps/core` — **1169 tes lolos**.
- `npm run test -w @cdps/domain` — **2567 tes lolos, 1 skip** (pre-existing).
  ⚠️ **Jangan jalankan suite penuh berkali-kali berturut-turut tanpa
  `db-rebuild.sh` di antaranya** — dua tes lama (`admin.test.ts` hari libur,
  `client.test.ts` Hold Service) menghitung baris `audit_log` PERSIS `1` untuk
  ID yang sama, dan `audit_log` append-only nol dibersihkan `afterEach` —
  run kedua di DB yang sama akan menaikkan hitungan itu dan gagal PALSU
  (ditemukan sesi ini, bukan regresi kode).
- `npm run test -w @cdps/api -- pdt` — 58 lolos, 2 skip.
- `npm run lint --workspaces` — bersih.

**Nol perubahan migrasi/skema** — kedua tabel dipakai APA ADANYA dari G1-01.
**Nol push ke GitHub sesi ini setelah modul KEEMPAT** — commit modul KETIGA
sudah di-push sebelumnya (lihat §2); modul KEEMPAT + revisi berkas ini masih
perlu dikomit terpisah.

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **`shopee_ads_cpc` — JANGAN dibangun tanpa sample asli.** `G1-09-2BII-ADS-CPC`
   sekarang butuh verifikasi grain baris (per-produk vs per-iklan) sebelum
   `kampanye_id` bisa diputuskan aman — salah pilih berisiko crash, bukan
   cuma data longgar (lihat §0 di atas + `docs/DECISIONS.md`).
2. **Kandidat modul KELIMA** (grain jelas, kolom lengkap, rendah risiko —
   pola yang sama dipakai memilih modul KEEMPAT):
   - `tt_transaction_product` → `pdt_fact_sku_period`? Grain PER PRODUK
     (`Product ID`), tapi `pdt_fact_sku_period` kuncinya `sku_id` (FK
     `pdt_sku_master`) bukan `platform_product_id` langsung — butuh lookup
     SKU master dulu (mirip `shopee_ads_cpc`, TAPI `tt_transaction_product`
     grainnya sudah eksplisit per-produk di `PDT_KOLOM_DIPANEN.md` §1.3, tidak
     ada ambiguitas legacy-parser seperti ads_cpc — VERIFIKASI ini dulu
     sebelum bangun, jangan asumsikan aman hanya karena "mirip").
   - `shopee_ams_afiliasi` → `pdt_fact_creator_period` (Shopee, sekarang ada
     penulis TikTok-nya) — kolomDipanen: `ID Affiliates`, omzet, komisi, ROI.
   - `shopee_ams_produk` → sinyal PX / kandidat `pdt_fact_sku_period` Shopee.
3. **Resolusi `sku_id` untuk `tt_video`/`shopee_ads_live` yang SUDAH ditulis**
   — keduanya masih menulis `sku_id=NULL` selamanya. `tt_video` sumber SKU-nya
   kolom `Produk` yang BELUM diverifikasi formatnya cocok dengan
   `tt_orders.SKU ID`/`Product Name` — verifikasi dulu, jangan tebak.
4. **`shopee_video`/`tt_live` masih BLOCKED** (`G1-09-2BII-SHOPEELIVE` +
   `G1-09-2BII-TTLIVE`) — jangan diulang kecuali ada sample asli baru.
5. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — kriteria `status_listing` →
   `nonaktif`/`dihapus_platform` belum ditentukan PRD; perlu keputusan
   pemilik/Hans-Anty sebelum dibangun.
6. Item lama masih terbuka, tidak tersentuh sejak sesi 13-16: `G1-07-
   PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`, `G1-09-DETEKSI-PREAMBLE-
   AMBIGU`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`.
7. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint konfirmasi
   identitas AM — masih belum ada.
8. **CI `db-and-migrations`** — masih belum diperbaiki (pra-ada, di luar
   cakupan PDT murni).

## 2. Konteks penting untuk sesi berikutnya

- **Kerja sesi ini ADA DI BRANCH SESI** (`claude/ecstatic-cannon-78wwsn`,
  fast-forward dari `origin/main` saat sesi dimulai). Modul KETIGA sudah
  di-push; modul KEEMPAT + revisi handoff ini masih perlu dikomit. BELUM
  di-PR/merge — cek dulu status branch sebelum menumpuk komit lebih lanjut.
- **Empat modul/empat tabel fakta (dari enam) kini punya penulis**:
  `pdt_fact_ads` (`shopee_ads_live`), `pdt_fact_content` (`tt_video`),
  `pdt_sku_master` (`shopee_parent_sku`+`tt_orders`), `pdt_fact_creator_period`
  (`tt_transaction_creator`). Sisa: `pdt_fact_sku_period` (nol penulis) + 20
  modul lain yang belum dipetakan ke tabel yang SUDAH punya penulis.
- **Progress ringkas G1-09**: lihat `docs/backlog/PDT_BACKLOG.md` §G1-09
  status teratas untuk rincian lengkap sesi ini.

---

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI16.md` — ringkasan merge PR #368.
- `docs/handoff/HANDOFF_PDT_SESI14.md`/`HANDOFF_PDT_SESI15.md` — modul
  pertama/kedua, detail teknis lengkap.
- `docs/DECISIONS.md` — baris Decided 2026-09-14 (modul KEEMPAT lalu KETIGA,
  paling atas) + Open baru/diperbarui `G1-09-2BII-SHOPEELIVE`,
  `G1-09-2BII-SKU-STATUS-TRANSISI`, `G1-09-2BII-ADS-CPC` (diperbarui).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah.
- `packages/core/src/pdt/fakta.ts` — docblock kepala berkas menjelaskan urutan
  keempat modul dan kenapa masing-masing dipilih.
