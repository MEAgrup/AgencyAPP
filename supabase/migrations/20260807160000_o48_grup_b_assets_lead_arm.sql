-- ============================================================================
-- O48 Grup B — `assets_select` mendapat arm `Lead/SPV = division-wide`.
--
-- Keputusan pemilik 2026-08-07: **pilihan (b)** — perbaiki PER TABEL sesuai
-- kebutuhan halaman, BUKAN menyapu ke-39 policy dalam satu migrasi. Ditambah
-- satu penajaman yang diterima pemilik: pasang **ledger invariant** sekarang
-- (`rls_checks.sql` §42) supaya sisanya tidak bisa dilupakan.
--
-- KENAPA TABEL INI, SEKARANG
-- ---------------------------------------------------------------------------
-- Ini bukan sapuan spekulatif: O52 (halaman detail Asset 404 untuk divisi
-- eksekusinya sendiri) diperbaiki di `20260807150000` dengan memindahkan AM
-- pemilik ke `private.brief_owner_am`, dan test jalur-baca-nyata
-- (`reads_rls.test.ts`, klaim `Creative/lead` lewat `SET LOCAL ROLE
-- authenticated`) membuktikan Brief-nya lolos tapi **Asset-nya masih 404** —
-- karena barisnya sendiri memang tak terlihat:
--
--     assets_select = jwt_can_read_all() OR assigned_pic = me OR created_by = me
--
-- Lead Creative bukan PIC dan bukan pembuat, jadi ia tidak melihat SATU PUN
-- Asset divisinya. Itulah butir pertama dari tiga yang O48 sebut "menggigit
-- langsung", dan halaman yang membutuhkannya sedang dikerjakan hari ini.
--
-- BENTUK ARM-nya
-- ---------------------------------------------------------------------------
-- `private.jwt_division_owns_brief(brief_id)` — BUKAN `jwt_division_owns_asset(id)`.
-- Keduanya menjawab pertanyaan yang sama, tapi yang kedua men-join `assets`
-- kembali dari dalam policy `assets` itu sendiri. Referensi-diri lewat fungsi
-- SECURITY DEFINER memang aman (definer = `postgres`, BYPASSRLS), tapi ia
-- membuat policy yang harus dibaca dua kali untuk diyakini benar, dan satu join
-- lebih mahal untuk jawaban yang identik. `assets.brief_id` sudah ada di baris
-- yang sedang dievaluasi.
--
-- `jwt_is_lead()` WAJIB tetap ada: tanpanya seluruh divisi ikut terbuka, dan
-- staff sudah punya jalannya sendiri lewat `assigned_pic`/`created_by`. Ini
-- persis arm yang PRD Phase 0 §4 Role Matrix minta ("Lead/SPV = division-wide"),
-- bukan pelonggaran baru.
--
-- SATU GUARD HILANG, DAN ITU DICATAT ALIH-ALIH DIDIAMKAN
-- ---------------------------------------------------------------------------
-- `rls_checks.sql` check 25 bertumpu pada premis "lead Creative TIDAK bisa
-- melihat baris `assets`" untuk membuktikan `private.jwt_division_owns_asset`
-- WAJIB SECURITY DEFINER (kalau seseorang menggantinya dengan `EXISTS` inline,
-- subquery-nya ikut tersaring RLS dan arm-nya mati diam-diam — kelas O46).
-- Migrasi ini membuat premis itu tidak benar lagi, sehingga check 25 kehilangan
-- daya bedanya. Ia TIDAK dihapus: premisnya dibalik menjadi asersi atas keadaan
-- baru, dan hilangnya guard itu ditulis di sana + di DECISIONS — karena guard
-- yang lenyap tanpa jejak adalah cara paling rapi untuk menghidupkan lagi cacat
-- yang ia jaga.
-- ============================================================================

DROP POLICY IF EXISTS assets_select ON public.assets;
CREATE POLICY assets_select ON public.assets FOR SELECT TO authenticated
USING (
  public.jwt_can_read_all()
  OR public.jwt_employee_id() = assigned_pic::text
  OR public.jwt_employee_id() = created_by::text
  -- O48 Grup B: lead/SPV melihat seluruh Asset divisinya, lewat divisi Brief
  -- induknya — satu-satunya tempat divisi eksekusi tercatat.
  OR (public.jwt_is_lead() AND private.jwt_division_owns_brief(brief_id::text))
);

COMMENT ON POLICY assets_select ON public.assets IS
  'O48 Grup B (2026-08-07): + arm Lead/SPV division-wide lewat divisi Brief '
  'induk. Sebelumnya lead Creative nol Asset di divisinya sendiri — halaman '
  'menjawab 200/404, tidak pernah 403, jadi tidak terlihat rusak.';
