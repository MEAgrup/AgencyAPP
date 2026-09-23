-- =============================================================================
-- F-03 lanjutan — koreksi bug laten: `tt_ads_manager_videoviews` mendapat
-- `anyOf` varian Bahasa Indonesia di `tanda_tangan_kolom` (migrasi
-- `20261205010000`, sample Lano Batik: 'Nama Iklan'/'Belanja'/'Impresi'/
-- 'Tayangan video') TAPI `kolom_dipanen` (whitelist WAJIB) tetap ejaan EN
-- literal ('Ad name'/'Spend'/'Impressions') TANPA baris `pdt_kolom_alias`
-- yang memetakannya.
--
-- Akibatnya: berkas Bahasa Indonesia DETEKSI benar (cocok signature) TAPI
-- GAGAL `validasiKolomWajib` (nol 'Ad name'/'Spend'/'Impressions' literal di
-- berkas itu, `packages/core/src/pdt/parsestatus.ts` `cariKolomWajib` hanya
-- menerima exact match ATAU alias terdaftar) — walau `ekstrakBarisTtamVideoViews`
-- (`fakta.ts`) sudah benar memakai `idxAlias` untuk membacanya. Bug kelas sama
-- lima-ejaan (`20261122010000`) — ditutup di sini dengan pola yang sama, TIGA
-- baris `pdt_kolom_alias` (Rule 9, append-only, `ON CONFLICT DO NOTHING`).
--
-- `versi` TIDAK dinaikkan (bukan kolom modul ini) — `pdt.registry.test.ts`
-- hanya menegakkan `PDT_KOLOM_ALIAS` set-equal terhadap DB, tidak ada versi
-- per baris alias.
-- =============================================================================

INSERT INTO pdt_kolom_alias (modul_kode, kolom_kanonik, alias, versi_pertama) VALUES
('tt_ads_manager_videoviews', 'Ad name', 'Nama Iklan', 1),
('tt_ads_manager_videoviews', 'Spend', 'Belanja', 1),
('tt_ads_manager_videoviews', 'Impressions', 'Impresi', 1)
ON CONFLICT DO NOTHING;
