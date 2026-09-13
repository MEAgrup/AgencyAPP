-- G1-09 sesi 13 · Tutup dua Open row `docs/DECISIONS.md` (2026-09-13) lewat
-- sample ASLI (Fim Motor) yang diunggah pemilik — bukan tebakan:
--
-- 1. G1-09-SIGNATURE-AMS-COLLISION: `shopee_ams_afiliasi.tanda_tangan_kolom`
--    bentrok dengan `shopee_ads_cpc`/`shopee_ads_search` (KEDUANYA membawa
--    preamble `Username` + kolom ber-substring 'omzet'). `ID Affiliates`
--    diverifikasi HANYA muncul di export AMS afiliasi asli, nol kemunculan di
--    ketiga modul ads Shopee lain atau `shopee_shop_stats`/`shopee_parent_sku`
--    — ditambahkan ke `must`.
-- 2. G1-09-PARENTSKU-PESANAN: `parentskudetail.xlsx` ASLI (40 kolom) TERNYATA
--    membawa `Pesanan Dibuat`/`Pesanan Siap Dikirim` per-SKU, sejajar dengan
--    dua kolom GMV yang sudah dipanen — ditambahkan ke `shopee_parent_sku
--    .kolom_dipanen`, memungkinkan rekonsiliasi Rule 13/14 penuh (GMV DAN
--    pesanan, bukan GMV-only).
--
-- CERMIN `packages/core/src/pdt/modules.ts` (lihat komentar per modul di sana
-- untuk detail penuh) — pola sama dengan migrasi seed G1-02
-- (20261012010000), dijaga sinkron oleh `packages/db/src/pdt.registry.test.ts`.
--
-- `pdt_parser_modul.versi` (per-baris) TIDAK dinaikkan di sini — kolom itu
-- belum punya konsumen (G1-11 reparse job belum dibangun,
-- `pdt.registry.test.ts` menegaskan seluruh baris tetap `versi=1`). Penanda
-- "perlu reparse" yang SUDAH dipakai (`pdt_upload_batch.parser_versi`) adalah
-- `PDT_PARSER_VERSI` TS (dinaikkan ke 2 di commit yang sama), ditulis oleh
-- `commitUploadBatch` — bukan kolom ini.

UPDATE pdt_parser_modul
SET tanda_tangan_kolom = '{"must": ["Omzet", "ID Affiliates"], "anyOf": [{"must": ["Username"]}, {"must": ["Kreator"]}, {"must": ["Creator"]}]}'::jsonb
WHERE kode = 'shopee_ams_afiliasi';

UPDATE pdt_parser_modul
SET kolom_dipanen = ARRAY[
  'Kode Produk','Kode Variasi','SKU Induk',
  'Total Penjualan (Pesanan Dibuat) (IDR)','Penjualan (Pesanan Siap Dikirim) (IDR)',
  'Pesanan Dibuat','Pesanan Siap Dikirim',
  'Jumlah Produk Dilihat','Produk Diklik','Tingkat Konversi (Pesanan yang Dibuat)',
  'repeat order','Pengunjung Produk (Kunjungan)'
]
WHERE kode = 'shopee_parent_sku';
