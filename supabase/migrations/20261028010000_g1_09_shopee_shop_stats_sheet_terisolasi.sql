-- CDPS — PDT G1-09-SHEET-BUKAN-PERTAMA (sesi 30): koreksi `pdt_parser_modul`
-- (seed G1-02) untuk `shopee_shop_stats`, mencerminkan koreksi yang sama di
-- `packages/core/src/pdt/modules.ts` (docs/DECISIONS.md) — gerbang dual-home
-- `pdt.registry.test.ts` (@cdps/db) menegakkan TS ≡ DB untuk
-- `tanda_tangan_kolom`/`baris_header_hint`, jadi baris ini WAJIB ikut berubah.
--
-- Sample asli (`fim_motor.shopee-shop-stats.*.xlsx`, 12-sheet workbook)
-- membuktikan tanda tangan LAMA salah: `'Pesanan Dibuat'` HANYA muncul
-- sebagai NAMA TAB sheet, bukan sebagai isi sel — sheetnya sendiri LANGSUNG
-- dimulai dari header ('Tanggal'/'Total Penjualan (IDR)'/dst.), nol baris
-- penanda seksi. Ketiga basis GMV (Rule 16) ternyata SHEET TERPISAH ('Pesanan
-- Dibuat'/'Pesanan Siap Dikirim'/'Pesanan Dibayar'), bukan tiga section
-- dalam satu sheet seperti tebakan lama — `namaSheet` (TS-only, bukan kolom
-- DB) mengunci modul ini ke sheet 'Pesanan Siap Dikirim' (basis default
-- laporan klien, sudah dipakai `commitUploadBatch`). Sinyal deteksi diganti
-- ke kolom yang SUNGGUH ADA di sheet terisolasi itu (sudah di kolom_dipanen
-- sejak seed awal); `baris_header_hint` turun dari 2 ke 1 karena header
-- LANGSUNG di baris pertama sheet terisolasi (nol baris penanda seksi untuk
-- dilewati).
--
-- `versi` SENGAJA TIDAK dinaikkan (pola sama migrasi
-- 20261019010000/20261020010000/20261027010000 — `pdt.registry.test.ts`
-- menegakkan versi === 1 untuk seluruh modul hari ini). Nol perubahan
-- `kolom_dipanen`.
UPDATE pdt_parser_modul
   SET tanda_tangan_kolom = '{"must": ["Total Penjualan (IDR)", "Total Pengunjung"]}'::jsonb,
       baris_header_hint = 1
 WHERE kode = 'shopee_shop_stats';
