-- =============================================================================
-- TT-ADS-GMVMAX-KAMPANYE (2026-09-30) · Seed `pdt_parser_modul` — dua modul
-- baru `tt_ads_product_kampanye`/`tt_ads_live_kampanye`. Cermin
-- `packages/core/src/pdt/modules.ts` `PDT_MODULES` — pola sama seed F-03
-- (`20261205010000`): INSERT karena modul lahir SESUDAH seed awal G1-02.
--
-- TikTok mengganti tampilan ekspor GMV Max jadi RINGKASAN PER KAMPANYE
-- ("Product campaign data <rentang>.xlsx" / "Live campaign data
-- <rentang>.xlsx", sheet `Data`, satu baris per kampanye). Kolom pembeda
-- modul lama (`ID produk`, `Nama LIVE`) hilang ⇒ nol modul cocok ⇒ bagian
-- iklan laporan PDT kosong. Diverifikasi terhadap sample asli Qadizza
-- Skincare (14–20 & 21–27 Sep 2026). Detail: `docs/DECISIONS.md` 2026-09-30.
--
-- Fakta tetap ditulis ke `pdt_fact_ads` dengan `sumber` LAMA
-- (`tt_ads_product`/`tt_ads_live`) — nol perubahan skema, nol perubahan
-- konsumen. `wajib = false` (sisi ads, pola sama modul lama), `versi = 1`
-- (`pdt.registry.test.ts` menegakkan versi===1 untuk seluruh modul).
-- =============================================================================

INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, kolom_opsional, wajib, versi) VALUES
('tt_ads_product_kampanye', 'tiktok', 'TikTok GMV Max — Product Campaigns (ringkasan per kampanye)',
 '{"must": ["ID Campaign", "Nama kampanye", "Biaya", "Pendapatan kotor", "Anggaran harian"], "mustNot": ["ID produk", "Nama LIVE", "Tayangan LIVE"]}'::jsonb,
 1,
 ARRAY['ID Campaign','Biaya','Pesanan SKU','Pendapatan kotor'],
 '{}',
 false, 1),
('tt_ads_live_kampanye', 'tiktok', 'TikTok GMV Max — Live Campaigns (ringkasan per kampanye)',
 '{"must": ["ID Campaign", "Nama kampanye", "Biaya", "Pendapatan kotor", "Tayangan LIVE"], "mustNot": ["Nama LIVE", "ID produk"]}'::jsonb,
 1,
 ARRAY['ID Campaign','Biaya','Pesanan SKU','Pendapatan kotor','Tayangan LIVE'],
 '{}',
 false, 1);

-- -----------------------------------------------------------------------------
-- `tt_product_analytics`: `'Status daftar produk'` → `kolom_opsional`.
-- Ekspor Analitik Produk tampilan baru (Linda Hijab & Qadizza Skincare,
-- 14–27 Sep 2026) tidak lagi membawa kolom ini. Ekstraktor PDT tidak pernah
-- membacanya, tapi sebagai kolom WAJIB di modul `wajib` ia menjatuhkan berkas
-- ke `gagal` dan menutup rekonsiliasi TikTok. `kolom_dipanen` TIDAK berubah.
-- -----------------------------------------------------------------------------
UPDATE pdt_parser_modul
   SET kolom_opsional = ARRAY['Nama','Klik produk','Produk terjual','Status daftar produk']
 WHERE kode = 'tt_product_analytics';
