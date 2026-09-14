-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — koreksi `pdt_parser_modul` (seed G1-02) untuk
-- `shopee_ams_produk`/`shopee_ams_afiliasi`, mencerminkan koreksi yang sama
-- di `packages/core/src/pdt/modules.ts` (docs/DECISIONS.md 2026-09-14,
-- sesi 20) — sample EKSPOR ASLI (Fim Motor, `ProductPerformance_*.csv` +
-- `AMSAffiliatePerformance_*.csv`) membuktikan ejaan lama TIDAK PERNAH cocok
-- berkas nyata:
--
--  1. `shopee_ams_produk`: `tanda_tangan_kolom` lama (`must: ["Omzet", "Nama
--     Produk"]`) gagal total — header asli ber-'Nama Item', bukan 'Nama
--     Produk'. Modul ini TIDAK PERNAH terdeteksi untuk berkas asli manapun
--     sejak G1-02. Dikoreksi ke `must: ["Kode Item", "Omzet"], mustNot: ["ID
--     Affiliates"]` (satu-satunya identitas modul ini yang tidak dimiliki
--     `shopee_ams_afiliasi`). `kolom_dipanen` dikoreksi ke ejaan persis
--     ('Nama Item', 'Omzet Penjualan(Rp)', 'Estimasi Komisi(Rp)').
--  2. `shopee_ams_afiliasi`: `tanda_tangan_kolom` TIDAK berubah (substring
--     'Omzet'/'Username' tetap cocok 'Omzet Penjualan(Rp)'/'Username
--     Affiliate' — deteksi sudah benar). `kolom_dipanen` DIKOREKSI —
--     `validasiKolomWajib` (exact PER SEL, beda dari deteksi substring)
--     memakai ejaan lama yang TIDAK PERNAH cocok berkas nyata, membuat modul
--     ini SELALU `parse_status='gagal'` walau sudah dipetakan ke
--     `pdt_fact_creator_period` sejak modul KELIMA (sesi 17).
--
-- `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi 20261019010000 —
-- `pdt.registry.test.ts` menegakkan versi === 1 untuk seluruh modul hari ini).
-- ============================================================================
UPDATE pdt_parser_modul
   SET tanda_tangan_kolom = '{"must": ["Kode Item", "Omzet"], "mustNot": ["ID Affiliates"]}'::jsonb,
       kolom_dipanen = ARRAY[
         'Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Produk Terjual',
         'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'
       ]
 WHERE kode = 'shopee_ams_produk';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual',
         'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'
       ]
 WHERE kode = 'shopee_ams_afiliasi';
