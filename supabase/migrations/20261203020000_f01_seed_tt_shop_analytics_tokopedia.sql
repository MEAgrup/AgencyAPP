-- =============================================================================
-- F-01 · Seed `pdt_parser_modul` — modul baru `tt_shop_analytics_tokopedia`
-- (M20 R8). Cermin `packages/core/src/pdt/modules.ts` `PDT_MODULES` — pola
-- sama seed awal G1-02 (`20261012010000`), satu baris INSERT baru karena ini
-- modul baru yang lahir SESUDAH seed awal (bukan koreksi baris yang sudah ada,
-- pola migrasi 20261022/20261107/20261119).
--
-- `platform = 'tiktok'` (bukan 'tokopedia' — CHECK `ck_pdt_parser_modul_platform`
-- TIDAK diperlebar) dan `versi = 1` (pdt.registry.test.ts menegakkan versi===1
-- untuk seluruh modul) — lihat docblock modul di `modules.ts` untuk alasan
-- lengkap PDT-22 disupersede R8.
-- =============================================================================

INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, kolom_opsional, wajib, versi) VALUES
('tt_shop_analytics_tokopedia', 'tiktok', 'Tokopedia — Analitik Toko (via TikTok Shop)',
 '{"must": ["GMV", "Pendapatan bruto", "Pengunjung"], "mustNot": ["GMV dari LIVE kreator", "ID Produk"]}'::jsonb,
 1,
 ARRAY['GMV','Pesanan','Pembeli','Produk terjual','Pengembalian dana','Pengunjung','Persentase konversi'],
 '{}',
 true, 1);
