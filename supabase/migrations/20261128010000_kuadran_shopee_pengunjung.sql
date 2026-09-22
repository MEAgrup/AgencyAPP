-- ============================================================================
-- KUADRAN-SHOPEE — `pdt_fact_sku_period.pengunjung`, sumbu-X kuadran produk
-- Shopee (mesin HTML `computeQuadrants`, `report/shopee/metrik.ts`).
--
-- KENAPA KOLOM BARU, BUKAN MEMAKAI `impresi` YANG SUDAH ADA. Keduanya ADA di
-- berkas yang sama (`parentskudetail`, modul `shopee_parent_sku`) dan keduanya
-- BERBEDA JAUH, dibaca langsung dari ekspor asli Fim Motor Juli 2026 — bukan
-- disimpulkan dari namanya:
--
--   Kode Produk 22571212550
--     'Jumlah Produk Dilihat'            = 1.383.429   → kolom `impresi`
--     'Pengunjung Produk (Kunjungan)'    =    32.949   → kolom INI
--
-- 42× jaraknya. Mesin lama memakai `pengunjung_produk` sebagai sumbu-X kuadran
-- DAN sebagai penyebut CR (`cr_basis = 'pesanan_per_pengunjung'`,
-- `REPORT_BENCH_SHOPEE_V1.kuadran`). Memakai `impresi` sebagai gantinya akan
-- membagi setiap CR dengan angka puluhan kali lebih besar, menjatuhkan
-- SELURUH katalog di bawah ambang 2%/4%, dan melabeli setiap produk
-- `evaluasi` — laporan yang salah tapi terlihat benar. Kolom terpisah membuat
-- kekeliruan itu mustahil, bukan sekadar tidak disarankan.
--
-- `'Pengunjung Produk (Kunjungan)'` SUDAH ada di `kolom_dipanen` DAN
-- `kolom_opsional` modul `shopee_parent_sku` sejak `20261123010000` — nol
-- perubahan registry di sini. Yang kurang selama ini penampungnya, bukan
-- izin panennya.
--
-- NULLABLE, dan itu bukan kelonggaran: kolomnya OPSIONAL di registry (satu
-- ekspor lama yang tidak membawanya jatuh ke `sebagian`, bukan `gagal` —
-- alasan yang sama yang `20261123010000` tuliskan), jadi baris fakta yang
-- lahir dari ekspor seperti itu memang tidak punya angka ini. `NULL` di sini
-- berarti "tidak diketahui" dan `klasifikasikanKuadranSkuShopee` membacanya
-- sebagai `tidak_tayang` — sama seperti mesin lama memperlakukan
-- `pengunjung_produk` yang hilang.
--
-- Nol backfill: baris `pdt_fact_sku_period` Shopee yang sudah ada tetap
-- `NULL` sampai batch klien itu di-commit ulang, dan commit ulang memang
-- jalur normalnya (`replace-on-recommit` — DELETE scope lalu INSERT, lihat
-- `@cdps/domain` `pdt.ts`). Menebak angka mundur dari `impresi` adalah persis
-- kekeliruan yang kolom ini ada untuk mencegah.
-- ============================================================================

ALTER TABLE public.pdt_fact_sku_period
    ADD COLUMN pengunjung integer NULL;

COMMENT ON COLUMN public.pdt_fact_sku_period.pengunjung IS
  'Pengunjung Produk (Kunjungan) — konsumen: sumbu-X kuadran SKU Shopee dan penyebut '
  'CR-nya (pesanan_dibuat / pengunjung). BUKAN impresi: impresi memuat "Jumlah Produk '
  'Dilihat" (tayangan halaman), angka yang pada ekspor nyata puluhan kali lebih besar. '
  'NULL = tidak terpanen (kolomnya opsional di registry shopee_parent_sku), bukan nol.';

-- Gerbang CI — nol perubahan struktural (satu ADD COLUMN nullable):
--   public base tables : nol tabel baru
--   entity_prefix      : nol prefix baru
--   sm_machines        : nol lifecycle baru
--   notif_events       : nol event notifikasi baru
