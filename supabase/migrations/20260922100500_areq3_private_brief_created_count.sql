-- ============================================================================
-- A-req-3 — jumlah unit kerja yang SUDAH dibuat untuk sebuah Brief, satu field
-- per baris antrean divisi. Permintaan Jalur B (B-1a): progres "n dari N" di
-- ANTREAN, bukan hanya di halaman Brief.
--
-- KENAPA SATU FIELD, BUKAN SATU RUTE
-- ---------------------------------------------------------------------------
-- Memanggil `GET /briefs/{id}/rollup` per baris antrean adalah N+1 di layar
-- yang justru dibuka untuk melihat SEMUA baris sekaligus. Pembilangnya harus
-- ikut di baris antrean itu sendiri.
--
-- KENAPA FUNGSI `private.*`, BUKAN SUBQUERY `count(*)` BIASA
-- ---------------------------------------------------------------------------
-- Ini bukan kehati-hatian teoretis; policy yang HIDUP hari ini dibaca dari DB
-- (bukan dari `rls_baseline.sql` — sudah 190+ migrasi menumpuk di atasnya):
--
--   assets_select ........... jwt_can_read_all()
--                             OR jwt_employee_id() = assigned_pic
--                             OR jwt_employee_id() = created_by
--                             OR (jwt_is_lead() AND private.jwt_division_owns_brief(brief_id))
--   creator_bookings_select . jwt_can_read_all()
--                             OR jwt_employee_id() = assigned_coordinator
--                             OR jwt_employee_id() = created_by
--
-- Sebuah `count(*)` biasa atas kedua tabel itu karena itu akan SALAH, diam-diam,
-- untuk tiga pembaca sah dari `account.listDivisionQueue`:
--
--   * STAFF divisi pelaksana — hanya melihat Asset yang ia PIC-nya. Brief
--     12 unit yang ia pegang 2 di antaranya akan terbaca "2 dari 12".
--   * LEAD Account — `jwt_division_owns_brief` menjawab false untuk Brief
--     Creative, jadi setiap baris terbaca "0 dari 12".
--   * Siapa pun di KOL yang bukan `assigned_coordinator` baris itu —
--     `creator_bookings_select` tidak punya lengan divisi sama sekali.
--
-- Dan angka yang salah lebih mahal daripada baris yang hilang: baris hilang
-- terlihat rusak, "2 dari 12" terlihat benar. Jadi jawabannya diberikan lewat
-- pintu O52 opsi (b) yang sudah diketok pemilik 2026-08-07 — fungsi `private.*`
-- SECURITY DEFINER — dan NOL policy dilebarkan. Pola + grant-nya sama persis
-- dengan `private.brief_client_id` (F-2, `20260922100000`).
--
-- KENAPA DUA TABEL DIJUMLAHKAN
-- ---------------------------------------------------------------------------
-- Unit kerja sebuah Brief hidup di TEPAT SATU tabel, ditentukan divisinya:
-- `assets` (Creative/Ads/tasks) atau `creator_bookings` (KOL). Itu bukan
-- tebakan — keduanya adalah satu-satunya tabel yang dihitung roll-up status
-- Brief (`task.recomputeBriefRollup` dan `kol.recomputeBriefRollup`). Salah
-- satunya selalu nol, jadi penjumlahan di bawah adalah "jumlah anak", bukan
-- pencampuran dua hal. Brief Live Stream lahir di luar rantai roll-up
-- (`[Dispatched to Vendor]`), jadi `live_stream_sessions` sengaja TIDAK ikut:
-- memasukkannya akan memberi pembilang kepada Brief yang tidak punya penyebut.
--
-- Nol tabel, nol prefix, nol mesin, nol event ⇒ gerbang 146/40/31/73 TETAP.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.brief_created_count(p_brief_id text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT (SELECT count(*) FROM public.assets a WHERE a.brief_id = p_brief_id)
       + (SELECT count(*) FROM public.creator_bookings b WHERE b.brief_id = p_brief_id)
$$;

COMMENT ON FUNCTION private.brief_created_count(text) IS
  'A-req-3 — jumlah unit kerja yang sudah dibuat untuk satu Brief (assets + '
  'creator_bookings; tepat satu dari keduanya terisi, ditentukan divisi Brief). '
  'Lewat fungsi, bukan count(*) langsung: assets_select tidak punya lengan '
  'staff/Account-lead dan creator_bookings_select tidak punya lengan divisi '
  'sama sekali, jadi count biasa mengembalikan angka yang SALAH (bukan baris '
  'yang hilang) untuk pembaca antrean yang sah — O52 opsi (b).';

REVOKE EXECUTE ON FUNCTION private.brief_created_count(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_created_count(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_created_count(text) TO authenticated, service_role;
