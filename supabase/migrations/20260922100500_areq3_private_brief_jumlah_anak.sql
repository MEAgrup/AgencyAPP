-- ============================================================================
-- A-req-3 — jumlah unit kerja anak, pada BARIS ANTREAN divisi.
--
-- Keluhannya: leader membuka antrean divisinya dan tidak bisa tahu sebuah Brief
-- sudah dipecah jadi berapa unit kerja — 12 Asset atau nol Asset terlihat sama.
--
-- ## KENAPA FUNGSI, BUKAN `count(*)` LANGSUNG DI `briefCols`
--
-- `briefCols` dipakai `account.listDivisionQueue`, yang dibaca lewat
-- `readAsActor` — RLS MENYALA. Sebuah subquery `count(*)` atas `assets` di situ
-- akan dihitung DI BAWAH policy pembacanya, dan `assets_select` punya lengan
-- `jwt_employee_id() = assigned_pic`: seorang STAFF Creative karena itu akan
-- melihat "1" untuk Brief berisi 12 Asset — hanya miliknya yang terhitung.
--
-- Itu kelas cacat yang lebih buruk dari 404 O52: subquery yang dipersempit RLS
-- **tidak melempar dan tidak membuang barisnya**, ia diam-diam mengembalikan
-- angka yang salah, dan halamannya menjawab 200 dengan penuh percaya diri.
-- Angka antrean yang salah lebih buruk daripada nol angka.
--
-- Jadi jawabannya lewat pintu `private.*` SECURITY DEFINER — keputusan O52 opsi
-- (b) yang sudah diketok pemilik 2026-08-07, dan pola yang sama dengan
-- `private.brief_client_toko` (F-2) serta `private.brief_source_creative_id`
-- (B-5). NOL policy dilebarkan: yang dibuka hanya satu ANGKA atas Brief yang
-- pemanggilnya sudah boleh membaca.
--
-- ## Kenapa satu fungsi ber-CASE, bukan empat subquery
--
-- Sebuah Brief hanya punya SATU jenis anak, ditentukan divisinya. Empat subquery
-- berarti tiga di antaranya selalu nol dan tetap dibayar per baris antrean.
-- `CASE` atas `assigned_division` membayar satu.
--
-- Divisi tanpa tabel anak (mis. Store Operation — unit kerjanya baru dibangun
-- di wave-nya sendiri, K-5) menghasilkan **0**, bukan NULL: "belum dipecah" dan
-- "divisi ini tidak punya unit kerja" dua-duanya benar dirender sebagai 0, dan
-- NULL akan memaksa setiap pemanggil menebak yang mana.
--
-- Nol tabel, nol prefix, nol mesin, nol event ⇒ gate 146/40/31/73 TETAP.
-- Rujukan: docs/handoff/HANDOFF_STR_PENSIUN_20260908.md §4 (A-req-3).
-- ============================================================================

CREATE OR REPLACE FUNCTION private.brief_jumlah_anak(p_brief_id text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT CASE b.assigned_division
           WHEN 'Creative' THEN
             (SELECT count(*) FROM public.assets a WHERE a.brief_id = b.id)
           WHEN 'Ads' THEN
             (SELECT count(*) FROM public.ad_campaigns c WHERE c.brief_id = b.id)
           WHEN 'KOL' THEN
             (SELECT count(*) FROM public.creator_bookings k WHERE k.brief_id = b.id)
           WHEN 'Live Stream' THEN
             (SELECT count(*) FROM public.live_stream_sessions l WHERE l.brief_id = b.id)
           ELSE 0
         END::integer
    FROM public.briefs b
   WHERE b.id = p_brief_id
$$;

COMMENT ON FUNCTION private.brief_jumlah_anak(text) IS
  'A-req-3 — jumlah unit kerja anak sebuah Brief (Asset / Campaign / Booking / '
  'Sesi Live), lewat pintu SECURITY DEFINER. Ada karena `briefCols` dibaca di '
  'bawah RLS: subquery count(*) langsung akan dipersempit policy pembacanya dan '
  'seorang staff melihat angka yang SALAH tanpa galat apa pun. Divisi tanpa '
  'tabel anak mengembalikan 0, bukan NULL.';

REVOKE EXECUTE ON FUNCTION private.brief_jumlah_anak(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_jumlah_anak(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_jumlah_anak(text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.brief_jumlah_anak(text) TO service_role;
  END IF;
END $$;
