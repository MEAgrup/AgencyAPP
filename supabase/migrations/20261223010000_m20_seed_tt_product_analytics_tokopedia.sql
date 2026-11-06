-- =============================================================================
-- M20-R8-PROD-TP · Seed `pdt_parser_modul` — modul baru
-- `tt_product_analytics_tokopedia` (Tokopedia — Analitik Produk).
--
-- Laporan Yulianti (29 Okt 2026): berkas "[bisnis]-Tokopedia produk" di ZIP
-- TikTok Shop jatuh ke "Perlu Pilih Modul" dan dropdown tidak punya opsi
-- Tokopedia — Analitik Produk. ACC Yohan 2026-11-06 — `docs/decisions/
-- 2026-11-06-m20-r8-prod-tp-tokopedia-analitik-produk.md`.
--
-- Cermin `packages/core/src/pdt/modules.ts` `PDT_MODULES` (pola sama
-- `20261203020000_f01_seed_tt_shop_analytics_tokopedia.sql`): `platform =
-- 'tiktok'` (CHECK tidak diperlebar), `versi = 1`. Nol perubahan skema.
-- =============================================================================

INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, kolom_opsional, wajib, versi) VALUES
('tt_product_analytics_tokopedia', 'tiktok', 'Tokopedia — Analitik Produk (via TikTok Shop)',
 '{"must": ["GMV tab Toko", "GMV dari kartu produk", "Produk"], "mustNot": ["GMV dari kreator"]}'::jsonb,
 1,
 ARRAY['Produk','GMV tab Toko','GMV dari kartu produk'],
 '{}',
 false, 1)
ON CONFLICT (kode) DO NOTHING;
