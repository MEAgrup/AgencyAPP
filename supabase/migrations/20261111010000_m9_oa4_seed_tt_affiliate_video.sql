-- =============================================================================
-- M9-OA-4 — seed modul PDT `tt_affiliate_video`.
--
-- Cermin literal entri `tt_affiliate_video` di `packages/core/src/pdt/modules.ts`
-- (`PDT_MODULES`), dijaga tetap identik oleh `packages/db/src/pdt.registry.test.ts`.
-- Pola sama dengan seluruh baris `pdt_parser_modul` lain: TS adalah sumber yang
-- dites, migrasi menyalin nilainya.
--
-- KENAPA MODUL INI ADA. M9-OA-4 (`docs/prd/CDPS_Module9_KOL.md`) menyisakan satu
-- pertanyaan terbuka sejak PRD ditulis: DARI MANA `creator_bookings.attributed_gmv`
-- diisi. Keputusan pemilik 2026-09-17 (`docs/DECISIONS.md`) menjawabnya: dari
-- ekspor "Custom report" TikTok Shop Affiliate SISI MCN/PARTNER, dicocokkan ke
-- Booking lewat `Video ID` yang sudah ada di `creator_bookings.content_link`.
-- Modul ini adalah pintu masuk berkas itu ke PDT.
--
-- BEDA DARI `tt_video`/`tt_transaction_creator`. Keduanya ekspor SISI SELLER
-- (Seller Center, header berbahasa Indonesia). Berkas ini sisi PARTNER/TAP,
-- header berbahasa Inggris, dan membawa kolom komisi partner yang tidak pernah
-- muncul di sisi seller — karena itu tanda tangannya memakai
-- `Affiliate video-attributed GMV` (kolom yang hanya ada di sisi partner)
-- bersama `Video ID`.
--
-- `Estimated affiliate partner commission ` BERAKHIR SPASI — itu ejaan asli di
-- berkas TikTok, ditulis apa adanya (kelas koreksi yang sama dengan
-- `ROI (Toko saat ini)` pada `tt_ads_live`, migrasi 20261107010000).
-- Menormalkannya membuat whitelist panen meleset untuk setiap berkas nyata.
--
-- `baris_header_hint` = 1: header memang di baris pertama, TANPA preamble sama
-- sekali. Periodenya karena itu dibaca dari kolom data `Date` — lihat
-- `PdtModuleDef.kolomPeriode` (`packages/core/src/pdt/types.ts`); field itu
-- TS-only dan sengaja TIDAK punya kolom pasangan di sini, sama seperti
-- `namaSheet`/`sheetTambahan`.
--
-- Idempoten: `ON CONFLICT (kode) DO UPDATE` — aman dijalankan ulang, dan aman
-- terhadap rebuild lokal yang menyeed ulang 20261012010000 lebih dulu.
-- =============================================================================

INSERT INTO pdt_parser_modul (kode, platform, nama_tampilan, tanda_tangan_kolom, baris_header_hint, kolom_dipanen, wajib, versi)
VALUES
('tt_affiliate_video', 'tiktok', 'TikTok Shop Affiliate — Custom Report (Campaign/Creator/Product/Shop/Video)',
 '{"must": ["Affiliate video-attributed GMV", "Video ID"]}'::jsonb,
 1,
 ARRAY['Date','Campaign ID','Campaign name','Creator name','Creator follower count','Product ID','Product name','Shop ID','Shop code','Shop name','Video ID','Video name','Post time','Duration','Affiliate video-attributed GMV','Creator video-attributed orders','Affiliate video orders','Estimated affiliate partner commission ','Actual affiliate partner commission','Video views','Video likes','Video product RPM','Creator-attributed items sold'],
 false, 1)
ON CONFLICT (kode) DO UPDATE SET
  platform          = EXCLUDED.platform,
  nama_tampilan     = EXCLUDED.nama_tampilan,
  tanda_tangan_kolom = EXCLUDED.tanda_tangan_kolom,
  baris_header_hint = EXCLUDED.baris_header_hint,
  kolom_dipanen     = EXCLUDED.kolom_dipanen,
  wajib             = EXCLUDED.wajib,
  versi             = EXCLUDED.versi;
