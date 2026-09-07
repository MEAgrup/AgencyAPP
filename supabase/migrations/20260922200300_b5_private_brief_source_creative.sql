-- ============================================================================
-- B-5 — `private.brief_source_creative_id`: pintu O52 untuk
--       `briefs.source_creative_brief_id`.
--
-- DITEMUKAN UAT PERAMBAN, bukan test. Seluruh suite hijau — termasuk dua tes
-- domain yang khusus meng-assert proyeksi kolom ini — sementara filternya
-- diam-diam TIDAK PERNAH berlaku di peramban.
--
-- ---------------------------------------------------------------------------
-- APA YANG SALAH
--
-- `ads.getCampaign` mengambil kolom itu lewat `left join briefs`. Rutenya
-- (`GET /campaigns/{id}`) berjalan `readAsActor`, jadi join-nya tersaring RLS —
-- dan `briefs_select` **nol arm staff divisi** (lihat "BLOKER A-5" di
-- `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md`). Diverifikasi dengan klaim
-- `{division:'Ads', level:'staff'}`:
--
--     staff Ads melihat baris brief Ads-nya .......... 0 baris
--     left join menghasilkan ......................... (NULL)
--
-- `LEFT` join tidak membuang baris kampanyenya — ia mengubah kolomnya jadi
-- NULL. Jadi `sourceCreativeBriefId` selalu `''` untuk **satu-satunya divisi
-- yang memakai field itu**, picker jatuh ke fallback "semua aset klien", dan
-- ketokan K-3 tidak pernah benar-benar berlaku. Nol galat, nol 403, nol test
-- merah: persis bentuk kegagalan yang O52 catat, dan alasan tes domain tidak
-- menangkapnya adalah koneksi tesnya BYPASSRLS.
--
-- ---------------------------------------------------------------------------
-- PINTUNYA
--
-- Pola PERSIS `private.brief_owner_am` (`20260807150000_o52_brief_owner_am.sql`),
-- dan pintu yang memang diminta `HANDOFF_FEEDBACK_OD_JALUR_B.md` ("kalau Jalur B
-- butuh kolom dari `services`/`clients`/`employees` di jalur baca divisi
-- eksekusi, pakai `private.*`"). Di sini kolomnya ada di `briefs` sendiri, tapi
-- masalahnya identik: barisnya tidak terlihat oleh divisi yang membacanya.
--
-- ⛔ BUKAN dengan melebarkan `briefs_select` — itu BLOKER A-5, tiket Jalur A,
--    dan menambalnya dari sini adalah tambal paralel yang aturan emas #2
--    larang. Fungsi ini menyelesaikan kebutuhan B-5 tanpa menyentuh policy
--    bersama, dan tetap benar setelah A-5 memperbaiki policy-nya.
-- ⛔ BUKAN dengan memindahkan `GET /campaigns/{id}` ke service-role — itu akan
--    mencabut SELURUH gerbang baris kampanyenya demi satu kolom opsional.
--
-- Nol tabel / prefix / mesin / event baru ⇒ gerbang 146 / 40 / 31 / 73 TETAP.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.brief_source_creative_id(p_brief_id text)
RETURNS varchar(32)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.source_creative_brief_id
    FROM public.briefs b
   WHERE b.id = p_brief_id
$$;

COMMENT ON FUNCTION private.brief_source_creative_id(text) IS
  'B-5/K-3 (2026-09-07): Brief Creative sumber sebuah Brief, lewat pintu SECURITY '
  'DEFINER. Ada karena `briefs_select` nol arm staff divisi, sehingga join ke '
  '`briefs` dari jalur baca divisi Ads mengembalikan NULL — filter picker aset '
  'diam-diam tidak pernah berlaku (kelas O52). Nol data selain kolom itu yang '
  'dibuka: pemanggilnya sudah harus melewati gerbang baca kampanyenya sendiri.';

REVOKE EXECUTE ON FUNCTION private.brief_source_creative_id(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.brief_source_creative_id(text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.brief_source_creative_id(text) TO service_role;
  END IF;
END $$;
