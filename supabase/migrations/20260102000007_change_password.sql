-- ============================================================================
-- BACK-PORT (C-03 / DECISIONS O38 opsi A) — verbatim dari project live `CDPS SG`,
-- versi remote `20260724161750_change_password`.
--
-- Sebelumnya hanya ada di live. Lihat catatan di 20260102000005 untuk konteks.
-- CATATAN PEMBACAAN: komentar bawaan di bawah menyebut "(O38)". Itu penomoran
-- lama dari sesi yang menulis migrasi ini langsung ke live; ia BUKAN O38
-- (drift skema repo↔live) di `docs/DECISIONS.md`. Komentar dibiarkan apa adanya
-- supaya isi file identik dengan yang ter-apply di produksi.
-- ============================================================================

-- clear_must_change_password(id) — flip the forced-change gate after a
-- successful GoTrue password change (O38). Service-role only; mirrors
-- set_employee_banned. Clears both employees + employee_credentials flags and
-- stamps password_changed_at.
CREATE OR REPLACE FUNCTION public.clear_must_change_password(p_employee_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  UPDATE public.employees
     SET must_change_password = false
   WHERE employee_id = p_employee_id;

  UPDATE public.employee_credentials
     SET must_change_password = false,
         password_changed_at  = now()
   WHERE employee_id = p_employee_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_must_change_password(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password(text) TO service_role;
