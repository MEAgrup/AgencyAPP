-- ============================================================================
-- PDT G1-00 — prasyarat data: `client_platforms.platform` jadi PILIHAN, bukan
-- teks bebas (ketokan F-5, `docs/handoff/HANDOFF_PDT_SESI1.md` §2.2 — "toko
-- yang melanggar itu toko testing"; tiket `docs/backlog/PDT_BACKLOG.md` G1-00).
--
-- Kosakata live hari ini (2026-09-13, query read-only ke `egddxfcnrtecheiykhlf`):
-- 'Shopee' (12) · 'TikTok Shop' (17) · 'Tokopedia' (1) · 'TikTok Shop, Shopee'
-- (2, gabungan) · 'TikTok Shop, Shopee, Tokopedia' (1, gabungan) — nol CHECK.
-- Ketiga baris gabungan itu milik klien yang F-8 tandai sebagai kandidat
-- testing. Daftar CHECK di bawah memuat lima nilai: tiga yang sudah dipakai
-- live (Shopee/TikTok Shop/Tokopedia) plus dua yang PDT PRD Rule 22 sebut
-- eksplisit sebagai kanal manual-entry sah (Lazada, Blibli) meski belum
-- punya baris — bukan mengarang, mengikuti PRD.
--
-- ⚠️ NOT VALID, disengaja (ketokan pemilik 2026-09-13): tiga baris gabungan
-- di atas milik klien testing yang MASIH DIBUTUHKAN untuk sekarang (belum
-- dibersihkan/di-nonaktifkan — bagian G1-00 lain yang ditunda). CHECK dengan
-- NOT VALID menolak nilai kotor BARU mulai sekarang (setiap INSERT/UPDATE
-- baru divalidasi penuh — semantik Postgres untuk NOT VALID), tanpa
-- memvalidasi ATAU menyentuh baris lama. `VALIDATE CONSTRAINT` menyusul
-- sebagai migrasi terpisah setelah klien testing dibersihkan/di-nonaktifkan.
-- ============================================================================
ALTER TABLE client_platforms
  ADD CONSTRAINT ck_client_platforms_platform
  CHECK (platform IN ('Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Blibli'))
  NOT VALID;

COMMENT ON CONSTRAINT ck_client_platforms_platform ON client_platforms IS
  'PDT G1-00 (ketokan F-5): platform harus salah satu nilai terkontrol, bukan teks bebas/gabungan. NOT VALID disengaja — baris lama milik klien testing belum divalidasi, menunggu pembersihan data testing (ditunda ketokan pemilik 2026-09-13). Lihat docs/DECISIONS.md.';
