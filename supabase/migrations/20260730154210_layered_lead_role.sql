-- ============================================================================
-- LAYERED ROLE `lead` — menjadikan SEORANG karyawan lead tanpa menaikkan
-- semua orang yang sejabatan dengannya.
--
-- Keputusan pemilik 2026-07-30: Ads lead = `2307100292`, KOL lead = `2602190630`,
-- Marketing lead = `2504240539` (A4 §3.2, `O34_O26_O35_WORKSHEET_ROSTER_V2.md`).
--
-- ----------------------------------------------------------------------------
-- KENAPA INI BUTUH MIGRASI, BUKAN CUKUP BARIS `role_mappings`
--
-- `role_mappings` berkunci **`UNIQUE (divisi, jabatan)`** dan `employee_claims`
-- menurunkan `level` HANYA dari sana. Jadi level melekat pada **jabatan**, bukan
-- pada orang. Diukur di live 2026-07-30:
--
--     employee_id   divisi(HRIS)  jabatan              jml sejabatan
--     2307100292    ADVERTISER    SENIOR ADVERTISER    3
--     2602190630    ACCOUNT       KOL SPECIALIST       3
--     2504240539    BUSINESS DEV  MARKETING STRATEGIST 1
--
-- Memetakan `SENIOR ADVERTISER → lead` akan menjadikan **ketiga** orang itu lead,
-- dua di antaranya bukan lead. Untuk KOL sama. Itu perluasan izin yang TIDAK
-- diminta, dan ia tidak akan terlihat: ketiganya sekadar mulai melihat data
-- se-divisi.
--
-- ----------------------------------------------------------------------------
-- KENAPA `employee_layered_roles`, BUKAN MENGUBAH `employees.jabatan`
--
-- Mengganti jabatan orangnya (mis. jadi `HEAD OF ADVERTISER`) juga "berhasil",
-- tapi `employees` **disinkronkan dari HRIS** (`CLAUDE.md`: employee sync
-- read-only). Sinkronisasi berikutnya akan mengembalikan jabatannya dan
-- **mencabut kepemimpinannya secara senyap** — persis kelas cacat yang berulang
-- di O46/O48: sesuatu yang terlihat selesai lalu diam-diam mati.
--
-- `employee_layered_roles` justru dibuat untuk ini: "layered roles on top of a
-- normal employee account" (`20260722053824_init.sql`), CDPS-lokal sehingga
-- kebal sinkronisasi HRIS, per-ORANG, dan sudah punya
-- `trg_sync_claims_layered` yang merambatkan perubahan ke klaim JWT. `od` dan
-- `director` sudah bekerja persis begitu; `lead` hanya melengkapi polanya.
-- Kolom `role` tidak punya CHECK constraint, jadi nol perubahan skema.
--
-- ----------------------------------------------------------------------------
-- SATU-SATUNYA PERUBAHAN PERILAKU
--
-- `employee_claims.level` kini: layered `lead` (bila enabled) MENANG atas
-- `role_mappings.level`; selain itu tidak ada yang berubah. `division` tetap
-- dari `role_mappings` — ketiga orang di atas sudah ber-divisi benar
-- (`Ads`/`KOL`/`Marketing`), yang kurang cuma level-nya.
--
-- Arahnya MEMPERLUAS untuk tepat tiga orang yang ditunjuk pemilik. Ia tidak bisa
-- menurunkan siapa pun: tanpa baris layered, hasilnya identik dengan sebelumnya.
--
-- SIFAT PERUBAHAN: 1 CREATE OR REPLACE FUNCTION. Nol tabel, nol kolom, nol
-- policy, nol event.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.employee_claims(p_employee_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT jsonb_build_object(
    'employee_id', e.employee_id,
    'division',    coalesce(rm.division, ''),
    -- Layered `lead` menang atas mapping jabatan. `coalesce` berhenti di argumen
    -- non-NULL pertama, jadi subquery yang tidak menemukan baris (NULL) jatuh
    -- bersih ke rm.level — nol perubahan bagi karyawan tanpa layered lead.
    'level',       coalesce(
                     (SELECT 'lead' FROM public.employee_layered_roles l
                       WHERE l.employee_id = e.employee_id
                         AND l.role = 'lead' AND l.enabled LIMIT 1),
                     rm.level, ''),
    'od',          coalesce((SELECT bool_or(l.enabled) FROM public.employee_layered_roles l
                             WHERE l.employee_id = e.employee_id AND l.role = 'od'), false),
    'director',    coalesce((SELECT bool_or(l.enabled) FROM public.employee_layered_roles l
                             WHERE l.employee_id = e.employee_id AND l.role = 'director'), false)
  )
  FROM public.employees e
  LEFT JOIN public.role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
  WHERE e.employee_id = p_employee_id;
$$;

-- Tetap bukan RPC publik (mengulang REVOKE 20260723071013: CREATE OR REPLACE
-- mempertahankan grant, tapi dinyatakan ulang supaya tidak bergantung pada itu).
REVOKE EXECUTE ON FUNCTION public.employee_claims(text) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.employee_claims(text) IS
  'Resolver klaim kanonik (division/level/od/director). Sejak 2026-07-30 level menghormati layered role `lead` (employee_layered_roles) supaya SEORANG karyawan bisa jadi lead tanpa menaikkan semua yang sejabatan — role_mappings berkunci (divisi,jabatan), bukan per-orang. Dipakai hook GoTrue, sync, import, DAN private.jwt_same_division/jwt_division_owns_client, jadi kedua sisi perbandingan RLS tidak bisa menyimpang.';
