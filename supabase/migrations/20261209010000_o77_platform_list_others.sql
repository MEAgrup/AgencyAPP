-- =============================================================================
-- O77 (docs/DECISIONS.md, terbuka sejak 2026-09-19) — kosakata Platform List
-- kembali disamakan dengan PRD M0 §4.3.
--
-- Migrasi `20261010010000_g1_00_client_platforms_platform_check.sql` menambah
-- `Blibli` ke CHECK sambil mengutip PDT-22 sebagai dasarnya. PDT-22 memang
-- menyebut Blibli — tapi sebagai CONTOH platform yang belum punya mesin parse
-- (bersama Tokopedia/Lazada), bukan sebagai pilihan Platform List. Kutipan itu
-- menjawab pertanyaan yang berbeda. M0 §4.3 (PRD, baris 105) sejak awal
-- menulis Platform List sebagai `Shopee / TikTok Shop / Tokopedia / Lazada /
-- Others` — `Others` tidak pernah dicabut di PRD, dan CHECK-lah yang salah.
--
-- Ketokan pemilik (via AskUserQuestion, 2026-09-24): "Others only" — CHECK
-- dikembalikan mengikuti PRD apa adanya; `Blibli` DICABUT dari Platform List
-- (tetap sah sebagai istilah PDT-22 untuk platform tanpa parser, tidak
-- tersentuh migrasi ini — itu pernyataan berbeda dari kosakata kolom ini).
--
-- Nol baris live memakai `Others` maupun `Blibli` (diverifikasi O77, dan
-- ulang di sini sebelum apply) — membalikkan nilai ini nol risiko data.
-- CHECK tetap NOT VALID: migrasi asal sengaja tidak memvalidasi baris lama
-- milik klien testing (ketokan pemilik 2026-09-13, belum dibersihkan);
-- membalik arah CHECK tidak mengubah keputusan itu.
-- =============================================================================
ALTER TABLE client_platforms
  DROP CONSTRAINT ck_client_platforms_platform;

ALTER TABLE client_platforms
  ADD CONSTRAINT ck_client_platforms_platform
  CHECK (platform IN ('Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Others'))
  NOT VALID;

COMMENT ON CONSTRAINT ck_client_platforms_platform ON client_platforms IS
  'PDT G1-00 (ketokan F-5) + O77 (2026-09-24): platform harus salah satu nilai terkontrol, bukan teks bebas/gabungan. Kosakata mengikuti PRD M0 §4.3 verbatim (Others, bukan Blibli — lihat docs/DECISIONS.md O77). NOT VALID disengaja — baris lama milik klien testing belum divalidasi (ketokan pemilik 2026-09-13).';
