-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — koreksi `pdt_parser_modul` (seed G1-02) untuk
-- `meta_ads`, mencerminkan koreksi yang sama di `packages/core/src/pdt/modules.ts`
-- (docs/DECISIONS.md 2026-09-14, sesi lanjutan pasca-sesi 20) — sample EKSPOR
-- ASLI Fim Motor (`Laporan-tanpa-judul-Jul-1-2026-hingga-Jul-31-2026.xlsx`,
-- sheet "Raw Data Report") membuktikan `kolom_dipanen` lama TIDAK PERNAH
-- cocok berkas nyata: 6 dari 11 entri lama ("Jumlah yang dibelanjakan",
-- "Nilai Konversi Pembelian", "ROAS", "CTR", "CPM", "CPC") hilang sufiks
-- panjang khas Meta Ads Manager yang sel asli sungguh punya ("(IDR)", "Khusus
-- untuk Item Bersama", dsb.) — bug laten kelas sama `shopee_ads_cpc`/AMS. Set
-- kolom yang dipanen TIDAK berubah secara konsep, cuma ejaannya dikoreksi.
-- `tanda_tangan_kolom` TIDAK berubah (substring 'dibelanjakan' tetap cocok).
--
-- `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi 20261019/20261020/
-- 20261021 — `pdt.registry.test.ts` menegakkan versi === 1 untuk seluruh
-- modul hari ini).
-- ============================================================================
UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'Nama kampanye', 'Nama iklan', 'Jumlah yang dibelanjakan (IDR)',
         'Nilai Konversi Pembelian Khusus untuk Item Bersama', 'ROAS pembelian khusus untuk item bersama',
         'Impresi', 'Klik tautan', 'CTR Unik (rasio klik tayang tautan)', 'CPM (Biaya Per 1.000 Tayangan)',
         'CPC (biaya per klik tautan)', 'Minggu'
       ]
 WHERE kode = 'meta_ads';
