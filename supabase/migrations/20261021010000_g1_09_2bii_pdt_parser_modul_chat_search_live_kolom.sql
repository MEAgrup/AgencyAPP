-- ============================================================================
-- PDT G1-09 sub-langkah 2b-ii — koreksi `pdt_parser_modul` (seed G1-02) untuk
-- `shopee_ads_search`, `shopee_live`, `shopee_chat`, `shopee_chat_broadcast`,
-- mencerminkan koreksi yang sama di `packages/core/src/pdt/modules.ts`
-- (docs/DECISIONS.md 2026-09-14, sesi lanjutan pasca-sesi 20) — sample
-- EKSPOR ASLI (Fim Motor, ZIP lengkap 15 berkas) membuktikan `kolom_dipanen`
-- lama TIDAK PERNAH cocok berkas nyata untuk keempat modul ini (bug laten
-- kelas sama `shopee_ads_cpc`/AMS, ditemukan lewat pembacaan header asli,
-- bukan ditebak):
--
--  1. `shopee_ads_search`: `klik`/`konversi` huruf kecil (PDT_KOLOM_DIPANEN
--     §2.4 sendiri menulis "casing belum terverifikasi") dikoreksi ke ejaan
--     persis sample asli (`Search-Ads-Overall-Data-*.csv`, header baris 8):
--     'Jumlah Klik'/'Konversi'. `tanda_tangan_kolom` TIDAK berubah (sudah
--     benar sejak G1-02).
--  2. `shopee_live`: 'Penjualan' dikoreksi ke ejaan persis sample asli
--     (`live_streaming_*.xlsx` sheet "Daftar Streaming"): 'Penjualan
--     (Pesanan Siap Dikirim)(Rp)'. Blocker identitas `G1-09-2BII-SHOPEELIVE`
--     TIDAK tertutup oleh migrasi ini — murni koreksi ejaan whitelist.
--  3. `shopee_chat`: 'Persentase Chat Dibalas' DIHAPUS — sample asli
--     (`chat_*.xlsx` sheet "Kriteria Utama") tidak punya kolom itu sama
--     sekali (bukan salah eja, kolomnya memang tidak ada; 'Tingkat Konversi
--     (Chat Dibalas)' yang ADA di sample adalah metrik berbeda, bukan
--     pengganti 1:1).
--  4. `shopee_chat_broadcast`: seluruh whitelist huruf kecil (`penerima`/
--     `dibaca`/`diklik`/`pesanan`, PDT_KOLOM_DIPANEN §2.9 sendiri menulis
--     "TEBAKAN KONVENSI") dikoreksi ke ejaan persis sample asli
--     (`Chat_Broadcast_overview_*.xlsx`): 'Total Penerima'/'Penerima yang
--     Membaca'/'Penerima yang Mengklik'/'Pesanan'. `tanda_tangan_kolom`
--     TIDAK berubah (substring lintas-sel tetap cocok, deteksi sudah benar).
--
-- `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi 20261019010000/
-- 20261020010000 — `pdt.registry.test.ts` menegakkan versi === 1 untuk
-- seluruh modul hari ini).
-- ============================================================================
UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['Jumlah Klik', 'Konversi']
 WHERE kode = 'shopee_ads_search';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan (Pesanan Siap Dikirim)(Rp)'
       ]
 WHERE kode = 'shopee_live';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY[
         'Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata', 'CSAT %',
         'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'
       ]
 WHERE kode = 'shopee_chat';

UPDATE pdt_parser_modul
   SET kolom_dipanen = ARRAY['Total Penerima', 'Penerima yang Membaca', 'Penerima yang Mengklik', 'Pesanan']
 WHERE kode = 'shopee_chat_broadcast';
