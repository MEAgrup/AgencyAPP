-- ============================================================================
-- B33-PARENT-SKU — `shopee_parent_sku` memberi makan `pdt_fact_sku_period`
-- (docs/DECISIONS.md 2026-09-20).
--
-- `pdt_parser_modul` adalah registry yang "hidup di DB, bukan di kode"
-- (komentar G1-01), dan `packages/db/src/pdt.registry.test.ts` menegakkannya
-- set-equal dengan `packages/core/src/pdt/modules.ts`. Migrasi ini membawa sisi
-- DB ke whitelist yang sama — pola persis `20261122010000`, `20261119010000`
-- (kolom_opsional) dan `20261107010000`.
--
-- KENAPA: laporan pemilik 2026-09-20 — "B-3.3 unit terjual masih kosong, data
-- ini ada di data parent sku detail". Benar, dan lebih dalam dari satu kolom:
-- `parentskudetail.xlsx` membawa performa per produk untuk SELURUH toko (nama,
-- GMV dua basis, unit terjual dua basis, pesanan, dilihat, klik), tapi modul
-- ini hanya pernah dipakai untuk identitas (`pdt_sku_master`) dan rekonsiliasi.
-- Satu-satunya pemasok `pdt_fact_sku_period` Shopee sebelum ini adalah
-- `shopee_ams_produk` — laporan AMS, yaitu irisan AFILIASI (Rp476 juta dari
-- Rp1,5 miliar pada CLI-202609-0020), tanpa nama produk.
--
-- LIMA kolom ditambahkan, verbatim dari header berkas ASLI
-- (`parentskudetail.20260701_20260731.xlsx`, Fim Motor — dibaca, bukan
-- ditebak):
--   'Produk'                          → nama produk (kolom ke-2)
--   'Produk (Pesanan Dibuat)'         → UNIT terjual, basis dibuat
--   'Produk (Pesanan Siap Dikirim)'   → UNIT terjual, basis siap dikirim
--   'Pesanan Dibuat'                  → jumlah PESANAN, basis dibuat
--   'Pesanan Siap Dikirim'            → jumlah PESANAN, basis siap dikirim
--
-- `'Produk (…)'` vs `'Pesanan (…)'` adalah dua kolom yang BERBEDA dan bukan
-- sinonim: pada baris yang sama berkas asli mencatat 1.798 pesanan dan 2.586
-- unit. Keduanya ditulis ke kolom skema yang berbeda pula (`pesanan` vs
-- `produk_terjual`) — menukar keduanya akan membuat B-3.3 melaporkan pesanan
-- sebagai unit.
--
-- Kelimanya ikut `kolom_opsional` DENGAN SENGAJA. `shopee_parent_sku` adalah
-- modul `wajib`, jadi menaruhnya sebagai kolom WAJIB berarti satu ekspor lama
-- yang tidak membawanya menjatuhkan berkas ke `parse_status='gagal'` — dan
-- karena berkas `gagal` dibuang dari `terparse`, pasangan rekonsiliasi Shopee
-- ikut tidak lengkap dan SELURUH batch klien itu berhenti mencapai `verified`.
-- Itu menukar satu kolom B-3.3 yang kosong dengan pintu upload yang tertutup;
-- persis kelas regresi yang `20261122010000` baru saja bereskan. Hilang ⇒
-- `sebagian`: berkasnya TETAP dipakai, hanya fakta per-SKU-nya yang tidak lahir.
--
-- `versi` SENGAJA TIDAK dinaikkan — `pdt.registry.test.ts` menegakkan
-- `versi === 1` untuk SELURUH modul (alasan sama migrasi-migrasi di atas).
--
-- Nol perubahan SKEMA: `pdt_fact_sku_period` sudah punya `nama_produk`
-- (20261108010000), `produk_terjual`, `pesanan`, `impresi` dan `klik`, dan
-- CHECK `ck_pdt_fsp_basis` sudah menerima 'dibuat'/'siap_dikirim'. Yang kurang
-- selama ini penulisnya, bukan tempatnya.
-- ============================================================================

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'Kode Produk','Kode Variasi','SKU Induk',
         'Total Penjualan (Pesanan Dibuat) (IDR)','Penjualan (Pesanan Siap Dikirim) (IDR)',
         'Jumlah Produk Dilihat','Produk Diklik',
         'Tingkat Konversi (Pesanan yang Dibuat)','Tingkat Pesanan Berulang (Pesanan Dibuat)',
         'Pengunjung Produk (Kunjungan)',
         'Produk','Produk (Pesanan Dibuat)','Produk (Pesanan Siap Dikirim)',
         'Pesanan Dibuat','Pesanan Siap Dikirim'
       ],
       kolom_opsional = ARRAY[
         'Pengunjung Produk (Kunjungan)',
         'Produk','Produk (Pesanan Dibuat)','Produk (Pesanan Siap Dikirim)',
         'Pesanan Dibuat','Pesanan Siap Dikirim'
       ]
 WHERE kode = 'shopee_parent_sku';
