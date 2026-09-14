# HANDOFF — PDT (Pusat Data Toko) SESI 19 → SESI 20

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 18 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI17.md` untuk detail teknis LENGKAP
> modul 3/4/5 — TIDAK diulang di sini). Instruksi sesi ini (Yohan): unggah
> `Shopee - Fim Motor.zip` (export Shopee ASLI, satu-satunya sumber data
> Shopee yang diunggah sesi ini — **bukan** sample sintetis), lanjutkan build
> dari `HANDOFF_PDT_SESI18.md`.

---

## 0. Apa yang terjadi sesi ini — modul KEENAM, `shopee_ads_cpc` → `pdt_fact_ads`

**Blocker `G1-09-2BII-ADS-CPC` — terbuka sejak sesi 13, diperbarui sesi 17 —
akhirnya TERTUTUP sesi ini.** Yohan mengunggah `Shopee - Fim Motor.zip` (15
berkas export Shopee ASLI, termasuk `Data+Keseluruhan+Iklan+Shopee-
01_07_2026-31_07_2026.csv` — **inilah sample yang lima sesi berturut-turut
diminta sebelum modul ini bisa dibangun**). Sample dibaca LANGSUNG (bukan
ditebak dari legacy parser saja) untuk memutuskan:

1. **Grain baris TERBUKTI per IKLAN, bukan per produk** — baris pertama
   sample (`Nama Iklan` = "Shop GMV Max", `Jenis Iklan` kosong, `Kode Produk`
   = `"-"`) adalah iklan TOKO: TIDAK punya `Kode Produk` sama sekali, tapi
   tetap baris data sah (legacy `parseAdsCsv` menerimanya, kunci `nama
   iklan`). `kampanye_id` (`uq_pdt_fact_ads`) karena itu memakai `nama iklan`
   — satu-satunya identitas baris yang SELALU ada di whitelist modul ini.
2. **Bug LATEN ditemukan & diperbaiki DI JALAN** (bukan cuma menulis fungsi
   ekstraksi) — `kolomDipanen` modul ini (`packages/core/src/pdt/modules.ts`
   + seed `pdt_parser_modul`) TERNYATA salah sejak G1-02, tidak pernah
   tertangkap karena fixture tes SEBELUM sesi ini memalsukan bentuk header
   (menaruh `'ID Toko'`/`'Periode'` sebagai kolom header buatan, bukan
   preamble sungguhan):
   - `ID Toko`/`Periode` (preamble, Rule 2, baris 1-6) SALAH dimasukkan
     sebagai kolom BARIS HEADER — `validasiKolomWajib` (`parsestatus.ts`)
     memeriksa SELURUH `kolomDipanen` terhadap SATU baris header saja, jadi
     kedua kolom itu SELALU gagal ditemukan untuk berkas ASLI apa pun (baris
     header sungguhan tidak akan pernah punya sel bernama "ID Toko"/
     "Periode" secara harfiah) — `parse_status` akan SELALU `'gagal'` untuk
     `shopee_ads_cpc` real, apa pun isinya. `shopee_ads_live`/
     `shopee_ads_search` tidak pernah membuat kesalahan yang sama (preseden
     yang benar, bukan modul ini).
   - Kolom ACOS dikoreksi ke ejaan PERSIS sample asli: `Persentase Biaya
     Iklan terhadap Penjualan dari Iklan (ACOS)` — ejaan lama (`Biaya Iklan
     Terhadap Omzet (ACOS) (%)`, `PDT_KOLOM_DIPANEN.md` §2.3 lama menulis
     "mis." di depannya) adalah tebakan yang TIDAK PERNAH cocok berkas nyata.
   - Dikoreksi di DUA tempat (`packages/core/src/pdt/modules.ts` DAN migrasi
     baru `UPDATE pdt_parser_modul` — mencegah drift yang sama yang G1-02
     disatukan untuk dicegah).
3. **Migrasi baru melebarkan `pdt_fact_ads.kampanye_id`** dari `varchar(128)`
   ke `varchar(255)` — kolom ini dirancang G1-01 dengan asumsi selalu ID
   pendek (`ID Iklan` numerik); `nama iklan` (TEKS BEBAS, bisa sepanjang
   nama produk yang dicerminnya) memaksanya. Sample asli sudah mencapai 116
   karakter untuk satu baris, mendekati batas 128 lama. `varchar(255)`
   mencermin `pdt_sku_master.nama_produk varchar(255)` (batas judul produk
   Shopee), bukan angka sembarang.
4. **`sku_id` SENGAJA TETAP `null`** — `Kode Produk` (whitelist modul ini)
   adalah level PRODUK INDUK, sedangkan `pdt_sku_master` (modul KETIGA)
   berkunci `(client_platform_id, platform_product_id, platform_variation_id)`
   PER VARIAN. Satu `Kode Produk` bisa cocok BANYAK baris `pdt_sku_master`
   (satu per varian) — lookup langsung akan mengarang varian mana yang
   dipilih. Dicatat Open baru `G1-09-2BII-ADS-CPC-SKU` — kelas ambiguitas
   SAMA dengan lookup lintas-tabel modul KEENAM/KETUJUH kandidat
   (`tt_transaction_product`/`shopee_ams_produk` → `pdt_fact_sku_period`,
   lihat §1 di bawah) yang belum punya preseden di PDT — sebaiknya
   diselesaikan BERSAMA, bukan ditebak terpisah untuk `shopee_ads_cpc` saja.

**Kode & tes:**
- `packages/core/src/pdt/fakta.ts` — `ekstrakBarisShopeeAdsCpc` (fungsi
  murni), docblock kepala berkas diperbarui (Modul KEENAM).
- `packages/core/src/pdt/modules.ts` — `shopee_ads_cpc.kolomDipanen`
  dikoreksi (ID Toko/Periode dihapus, ACOS diperbaiki).
- `packages/domain/src/pdt.ts` `commitUploadBatch` — blok replace-on-recommit
  `pdt_fact_ads` untuk `shopee_ads_cpc` (pola sama `shopee_ads_live`, sumber
  berbeda), sebelum `insertAudit`.
- `supabase/migrations/20261018010000_..._pdt_fact_ads_kampanye_id_lebar.sql`
  — lebarkan `kampanye_id` ke `varchar(255)`.
- `supabase/migrations/20261019010000_..._pdt_parser_modul_shopee_ads_cpc_kolom.sql`
  — koreksi seed `pdt_parser_modul.kolom_dipanen` untuk `shopee_ads_cpc`.
- `packages/core/src/pdt/fakta.test.ts` — +6 tes murni (grain per-iklan,
  baris "Shop GMV Max" tanpa Kode Produk, konvensi angka, baris kosong
  dilewati, dua iklan Kode Produk sama, kolom opsional hilang).
- `packages/domain/src/pdt.test.ts` — +4 tes DB baru (`describeDb`) + 3 tes
  lama (`previewUploadBatch` kolomDipanen/kolomBaru) diperbarui untuk
  mencerminkan `kolomDipanen` yang benar (9, bukan 11; `kolomBaru` sekarang
  menyertakan `ID Toko`/`Periode`).
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.3 — dikoreksi (preamble dipisah
  dari bucket 1, ejaan ACOS benar, catatan grain per-iklan).

**Verifikasi (DB lokal direbuild bersih dari 236 migrasi, semua gerbang
lolos):**
- `npm run typecheck --workspaces` — bersih (4 paket + `web-internal`).
- `npm run test -w @cdps/core` — **1180 tes lolos** (naik dari 1174).
- `npm run test -w @cdps/domain` — **2578 tes lolos, 1 skip** (naik dari
  2574; DB direbuild sebelum angka final diambil — dua tes lama `admin.test.ts`
  hari libur/`client.test.ts` Hold Service SEMPAT gagal palsu karena suite
  dijalankan dua kali tanpa rebuild di antaranya, pola yang sama seperti
  dicatat `HANDOFF_PDT_SESI17.md` — bukan regresi, sudah dikonfirmasi ulang
  bersih sesudah rebuild).
- `npm run test -w @cdps/api` — **567 tes lolos, 2 skip** (nol regresi).
- `cd web-internal && npm test` — **763 tes lolos** + typecheck bersih.
- `npm run lint -w @cdps/api -- --max-warnings 0` — bersih.

**Nol perubahan lain di luar cakupan ini** — data Fim Motor yang diunggah
punya 15 berkas total (lihat §1 butir 1 untuk pemetaan kandidat berikutnya
dari berkas yang SAMA, belum dibangun sesi ini).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Kandidat modul KETUJUH — data SUDAH ADA di ZIP Fim Motor yang sama,
   belum dipetakan sesi ini:**
   - `ProductPerformance_202608101517.csv` — SANGAT MUNGKIN `shopee_ams_produk`
     (grain PER PRODUK, `Kode Item`, `PDT_KOLOM_DIPANEN.md` §2.10) — nama
     berkas & timestamp (`202608101517`) satu menit persis dari
     `AMSAffiliatePerformance_202608101516.csv` (`shopee_ams_afiliasi`, sudah
     dipetakan modul KELIMA sesi 17) — sinyal kuat kedua berkas diunduh dari
     dashboard AMS yang sama, TAPI verifikasi dulu isi headernya (Rule 6 —
     nama berkas bukan tanda tangan) sebelum diasumsikan. Grain PER PRODUK
     berarti tabel tujuannya `pdt_fact_sku_period` (BUKAN
     `pdt_fact_creator_period` seperti modul KELIMA) — **inilah kandidat
     lookup lintas-tabel PERTAMA di PDT** (butuh `pdt_sku_master.id`, belum
     ada preseden) — sama ambiguitas dengan `G1-09-2BII-ADS-CPC-SKU` di atas
     (`Kode Item` vs `Kode Produk`/`Kode Variasi` `pdt_sku_master` perlu
     diverifikasi apakah level yang SAMA sebelum dipakai kunci lookup).
   - Berkas lain di ZIP yang sama BELUM diperiksa headernya sama sekali sesi
     ini: `chat_20260701_20260731.xlsx` (`shopee_chat`?),
     `Chat_Broadcast_overview_20260701-20260731.xlsx` (`shopee_chat_broadcast`?),
     `discount_20260701-20260731.xlsx`/`voucher_20260701-20260731.xlsx`/
     `In_Shop_Flash_Sale_Metrics_01072026-31072026.xlsx` (`shopee_voucher`/
     `shopee_diskon`/`shopee_flash_sale`?), `live_streaming_01072026-
     31072026.xlsx` (`shopee_live` — **MASIH BLOCKED**, `G1-09-2BII-SHOPEELIVE`,
     cek dulu apakah sample ini kebetulan membawa ID sesi yang stabil sebelum
     percaya blocker lama otomatis terbuka), `video-overview-v3_1m_2026-07-31_
     h4hr6t1_1786349868376.csv` (`shopee_video` — masih `UNVERIFIED_SIGNATURE`,
     cek apakah sample ini akhirnya memverifikasinya),
     `fim_motor.shopee-shop-stats.20260701-20260731.xlsx` (`shopee_shop_stats`,
     SUDAH punya penulis sejak awal — pakai untuk uji ulang/regresi, bukan
     modul baru), `parentskudetail.20260701_20260731.xlsx` (`shopee_parent_sku`,
     SUDAH punya penulis modul KETIGA), `Search-Ads-Overall-Data-*.csv`
     (`shopee_ads_search`, MASIH BLOCKED — `G1-09-2BII-ADS-SEARCH`, cek apakah
     sample ini akhirnya membawa kolom `biaya`/identitas yang whitelist lama
     bilang tidak ada), `Data-Semua-Iklan-Live-*.csv` (`shopee_ads_live`,
     SUDAH punya penulis modul PERTAMA — pakai untuk regresi),
     `Laporan-tanpa-judul-Jul-1-2026-hingga-Jul-31-2026.xlsx` (`meta_ads`,
     modul opsional PDT-22, belum dipetakan ke tabel fakta manapun — cek PRD
     apakah memang tidak perlu).
   - **Zip lengkap masih ada di scratchpad sesi ini** (tidak otomatis
     tersedia sesi berikutnya) — kalau sesi berikutnya tidak punya aksesnya
     lagi, minta Yohan unggah ulang `Shopee - Fim Motor.zip` sebelum
     memverifikasi header berkas-berkas di atas; JANGAN menebak nama kolom
     dari nama berkas semata (Rule 6, persis pelajaran UAT Fim Motor G1-02).
2. **`G1-09-2BII-ADS-CPC-SKU` (Open baru sesi ini)** — resolusi `sku_id`
   untuk `shopee_ads_cpc` butuh pola lookup produk-induk→SKU-master yang
   BELUM ada preseden-nya di PDT. Sebaiknya dirancang BERSAMA kandidat modul
   KETUJUH di atas (kemungkinan besar butuh solusi yang sama), bukan
   diselesaikan terpisah untuk satu modul saja.
3. Item lama dari sesi 17/18 TETAP terbuka, tidak tersentuh sesi ini:
   `G1-07-PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`,
   `G1-09-DETEKSI-PREAMBLE-AMBIGU`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`,
   `G1-07-PERSKU-DIBAYAR`, `G1-09-2BII-SHOPEELIVE`,
   `G1-09-2BII-SKU-STATUS-TRANSISI`, `G1-09-2BII-ADS-SEARCH`.
4. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint
   konfirmasi identitas AM (`usulkan_ikat` → `client_platforms.shop_id`/
   `akun_konten_toko`) — masih belum ada.
5. **Resolusi `sku_id` untuk `tt_video`/`shopee_ads_live` yang SUDAH ditulis**
   — keduanya masih `sku_id=NULL` selamanya, belum tersentuh (lihat handoff
   sesi 17/18 untuk detail).

## 2. Konteks penting untuk sesi berikutnya

- **Enam modul/lima tabel fakta (dari enam) kini punya penulis**:
  `pdt_fact_ads` (`shopee_ads_live`, `shopee_ads_cpc`), `pdt_fact_content`
  (`tt_video`), `pdt_sku_master` (`shopee_parent_sku`+`tt_orders`),
  `pdt_fact_creator_period` (`tt_transaction_creator` +
  `shopee_ams_afiliasi`, KEDUA platform). **Sisa SATU tabel fakta tanpa
  penulis: `pdt_fact_sku_period`** + 19 modul lain belum dipetakan.
- **Setup DB lokal (kalau kontainer baru, ulangi urutan ini):**
  ```
  pg_ctlcluster 16 main start
  su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
  bash scripts/db-rebuild.sh --yes
  ```
  Password TIDAK persisten antar restart cluster. `npm install` di root DAN
  `cd web-internal && npm install` terpisah.
- ⚠️ **Jangan jalankan suite penuh `@cdps/domain` berkali-kali berturut-turut
  tanpa `db-rebuild.sh` di antaranya** — `admin.test.ts`/`client.test.ts`
  menghitung baris `audit_log` PERSIS dan akan gagal PALSU di run kedua
  (sudah ditemukan & dicatat sesi 17, terulang sesi ini — bukan regresi).
- **Progress ringkas G1-09**: lihat `docs/backlog/PDT_BACKLOG.md` §G1-09
  status teratas (enam update status tercatat, modul 1-6).

---

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI17.md`/`SESI18.md` — detail teknis modul 3/4/5,
  status merge PR #373.
- `docs/DECISIONS.md` — baris Decided teratas (modul KEENAM, sesi 19) +
  `G1-09-2BII-ADS-CPC` (DITUTUP, strikethrough) + Open baru
  `G1-09-2BII-ADS-CPC-SKU`.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.3 — dikoreksi sesi ini (preamble
  vs header, ejaan ACOS, catatan grain per-iklan).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah.
- `packages/core/src/pdt/fakta.ts` — docblock kepala berkas menjelaskan
  keenam modul dan kenapa masing-masing dipilih.
- File asli `Shopee - Fim Motor.zip` (diunggah Yohan sesi ini) — 15 berkas,
  lihat §1 butir 1 untuk daftar lengkap yang belum diperiksa.
