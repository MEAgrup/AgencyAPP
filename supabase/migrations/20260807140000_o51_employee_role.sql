-- ============================================================================
-- O51 — `GET /portal/me` menjawab 500 untuk SETIAP aktor.
--
-- Keputusan pemilik 2026-08-07: **pilihan (a)** — fungsi SECURITY DEFINER
-- `private.employee_role(employee_id)`, bukan (b) "ambil dari klaim aktor".
--
-- GEJALA: buka `/portal` sebagai siapa pun ⇒ 500 opaque. Rantainya
-- `portal.staffLanding` → `performance.previewCurrent` → `performance.staffRoleType`,
-- yang menjalankan:
--
--     select rm.division, rm.level
--       from employees e join role_mappings rm on rm.divisi = e.divisi …
--
-- Route-nya memakai `readAsActor` (`SET LOCAL ROLE authenticated`), dan
-- `role_mappings` ada di grup "internal murni" `rls_baseline` §5 (SELECT dicabut
-- dari `authenticated`) ⇒ `42501 permission denied for table role_mappings`.
-- `staffLanding` hanya menelan `performance.NotFoundError`; error Postgres
-- dilempar ulang, `mapError` tidak memetakannya ⇒ 500. Diverifikasi langsung di
-- live `CDPS SG` dengan klaim Direktur.
--
-- Ini kelas yang SAMA dengan `sm_edges` (20260803123327) dan diperbaiki dengan
-- pola yang sama: tabelnya TETAP tertutup, yang dibuka hanya JAWABANNYA lewat
-- schema `private` (tidak diekspos PostgREST).
--
-- KENAPA (a) DAN BUKAN (b)
-- ---------------------------------------------------------------------------
-- (b) — `previewCurrent` mengambil roleType dari klaim aktor ketika
-- `staffID = actor.employeeId` — benar untuk satu-satunya pemakaian yang ada
-- HARI INI, dan salah untuk pemakaian berikutnya: M15 Team/Management justru
-- meminta melihat roleType ORANG LAIN, jadi (b) akan dibongkar lagi di tiket
-- M15 berikutnya. (a) juga menutup KELASNYA, bukan instansnya: setiap pembaca
-- role seseorang di jalur baca punya satu pintu yang sah.
--
-- Kenapa bukan `GRANT SELECT ON role_mappings TO authenticated`: alasan yang
-- sama persis dengan 20260803123327 §Mengapa-bukan-GRANT. `role_mappings`
-- adalah tabel yang menentukan SELURUH permission (`employee_claims`
-- menurunkan division/level darinya) — membukanya ke `authenticated` berarti
-- setiap pengguna bisa membaca peta peran seluruh perusahaan untuk menemukan
-- siapa yang bisa apa. Fungsi ini mengembalikan jauh lebih sedikit: division +
-- level untuk SATU karyawan.
--
-- CAKUPAN: sweep `packages/domain` + `packages/core` (dicatat di DECISIONS
-- 2026-08-03/O51) menemukan `staffRoleType` adalah SATU-SATUNYA pembaca
-- `role_mappings` di jalur baca. Sisanya jalur TULIS (dipanggil dengan `tx`
-- privileged), job service-role, atau fungsi yang memang berdokumentasi
-- privileged. Perbaikan ini seluas bug-nya, tidak lebih.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Peran M14 satu karyawan. INNER JOIN — bukan LEFT — disengaja dan menjaga
-- kontrak pemanggil apa adanya: karyawan tanpa baris mapping (mis. Director/OD
-- murni, lihat komentar `20260102000004` §2) menghasilkan NOL BARIS, dan
-- `staffRoleType` sudah memetakan nol baris ke `null` ⇒ `NotFoundError`.
-- Mengubahnya jadi LEFT JOIN akan mengembalikan `('','')` dan membuat
-- `roleTypeFor` memutuskan atas divisi kosong — jawaban yang terlihat valid
-- untuk pertanyaan yang seharusnya tidak punya jawaban.
--
-- `employees` tidak difilter `status_aktif`: `staffRoleType` sebelum migrasi ini
-- juga tidak, dan menambahkan filter di sini akan diam-diam mengubah perilaku
-- M14 untuk karyawan nonaktif (snapshot historis mereka masih dibaca) di
-- migrasi yang mengaku cuma memindahkan lokasi kueri.
CREATE OR REPLACE FUNCTION private.employee_role(p_employee_id text)
RETURNS TABLE (division text, level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT rm.division, rm.level
    FROM public.employees e
    JOIN public.role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
   WHERE e.employee_id = p_employee_id
$$;

COMMENT ON FUNCTION private.employee_role(text) IS
  'O51 — division/level M14 satu karyawan. Dibuka karena `role_mappings` '
  'default-deny untuk `authenticated` dan jalur baca M15 membutuhkannya. '
  'Nol baris = tanpa mapping (Director/OD murni), bukan error.';

-- Permukaan EXECUTE: `authenticated` WAJIB bisa (itulah jalur baca yang
-- diperbaiki), `service_role` untuk job snapshot batch. `public`/`anon` dicabut.
REVOKE EXECUTE ON FUNCTION private.employee_role(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.employee_role(text) FROM anon;
GRANT EXECUTE ON FUNCTION private.employee_role(text) TO authenticated, service_role;
