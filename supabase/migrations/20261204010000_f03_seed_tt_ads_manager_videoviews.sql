-- =============================================================================
-- F-03 (M20 R9, videoviews-only) · Seed `pdt_parser_modul` — modul baru
-- `tt_ads_manager_videoviews`. Cermin `packages/core/src/pdt/modules.ts`
-- `PDT_MODULES` — pola sama seed baru F-01 (`20261203020000`): satu baris
-- INSERT karena modul ini lahir SESUDAH seed awal G1-02.
--
-- `platform = 'tiktok'` (TikTok Ads Manager, sama realm dengan `tt_ads_product`/
-- `tt_ads_live`). `tanda_tangan_kolom` DIKOREKSI dari dugaan literal PRD R9
-- ("Video views" DAN "CPM") setelah diverifikasi terhadap sample asli pemilik
-- (Ultrasleep, `Ultrasleep_Video_views_TTAM.xlsx`) — berkas nyata TIDAK punya
-- kolom literal 'Video views', melainkan '6-second focused views' (metrik
-- "Focused View" TikTok, generasi ekspor lebih baru). Lihat docblock modul di
-- `modules.ts` untuk detail penuh dan kenapa `anyOf` (Ad name / Ad group name)
-- dipakai sebagai gerbang umbrella "ini Ads Manager", meniru
-- `report/detect.ts` `detectTtam`'s `isAdsManager`.
--
-- `wajib = false` (opsional, sisi ads, bukan sisi rekonsiliasi GMV toko — pola
-- sama `tt_ads_product`/`tt_ads_live`), `versi = 1` (pdt.registry.test.ts
-- menegakkan versi===1 untuk seluruh modul).
-- =============================================================================

INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, kolom_opsional, wajib, versi) VALUES
('tt_ads_manager_videoviews', 'tiktok', 'TikTok Ads Manager — Video Views (upper funnel)',
 '{"must": ["Spend", "CPM", "6-second focused views"], "anyOf": [{"must": ["Ad name"]}, {"must": ["Ad group name"]}]}'::jsonb,
 1,
 ARRAY['Ad name','Spend','Impressions'],
 '{}',
 false, 1);
