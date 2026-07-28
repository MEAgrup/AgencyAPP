-- ============================================================================
-- BACK-PORT (C-03 / DECISIONS O38 opsi A) — verbatim dari project live `CDPS SG`,
-- versi remote `20260724134427_employee_display_name`.
--
-- Sebelumnya hanya ada di live. Lihat catatan di 20260102000005 untuk konteks.
-- CATATAN: fungsi ini DIPINDAH ke schema `private` oleh migrasi 20260102000008.
-- Ia dibuat di `public` di sini supaya urutan repo mereproduksi urutan live
-- (buat dulu di public, baru relokasi) — jangan digabung/dipersingkat.
-- ============================================================================

-- employee_display_name(id) — RLS-safe owner/PIC name resolver (O37).
-- Reads run as `authenticated`, so RLS restricts public.employees to the
-- caller's own row; list/detail reads that show another person's name resolve
-- only the display name (nama) via this SECURITY DEFINER function, never any
-- other column, with the id itself as fallback. search_path locked.
CREATE OR REPLACE FUNCTION public.employee_display_name(p_employee_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT e.nama FROM public.employees e WHERE e.employee_id = p_employee_id),
    p_employee_id
  )
$$;
REVOKE ALL ON FUNCTION public.employee_display_name(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.employee_display_name(text) TO authenticated, service_role;
