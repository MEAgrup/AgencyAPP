-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — modul KEENAM: koreksi `pdt_parser_modul`
-- (seed G1-02) untuk `shopee_ads_cpc`, mencerminkan koreksi yang sama di
-- `packages/core/src/pdt/modules.ts` (docs/DECISIONS.md 2026-09-14 modul
-- KEENAM) — supaya kedua registry ("hidup di sini, bukan di kode", komentar
-- G1-01 `pdt_parser_modul.kolom_dipanen") tidak DRIFT lagi satu sama lain,
-- persis masalah yang G1-02 disatukan untuk mencegah.
--
-- Ditemukan lewat sample EKSPOR ASLI (Fim Motor, bukan tebakan):
--  1. `ID Toko`/`Periode` DIHAPUS — keduanya PREAMBLE (baris 1-6, Rule 2),
--     BUKAN kolom baris header (baris 8). `shopee_ads_live`/`shopee_ads_search`
--     tidak pernah membawa keduanya di kolom_dipanen masing-masing — preseden
--     yang benar.
--  2. Kolom ACOS DIKOREKSI ke ejaan PERSIS berkas asli: `Persentase Biaya
--     Iklan terhadap Penjualan dari Iklan (ACOS)` — ejaan lama (`Biaya Iklan
--     Terhadap Omzet (ACOS) (%)`) adalah tebakan yang tidak pernah cocok
--     dengan berkas nyata mana pun.
-- ============================================================================
-- `versi` SENGAJA TIDAK dinaikkan (`pdt.registry.test.ts` menegakkan
-- `versi === 1` untuk SELURUH modul hari ini — kolomnya belum punya makna
-- "versi ke berapa" yang ditegakkan di luar 1, beda dari `pdt_benchmark.versi`
-- yang memang berversi berlapis).
UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
         'nama iklan', 'omzet penjualan', 'Efektifitas Iklan',
         'Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)'
       ]
 WHERE kode = 'shopee_ads_cpc';
