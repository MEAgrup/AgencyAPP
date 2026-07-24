-- ============================================================================
-- clear_must_change_password(id) — flip the forced-change gate after a
-- successful password change (O38).
--
-- CDPS login is owned by GoTrue; the actual password lives in
-- auth.users.encrypted_password and is updated via GoTrue's PUT /auth/v1/user
-- (apps/api /auth/change-password). The one thing GoTrue does NOT track is our
-- "must change on first login" gate, which import_employee_credentials copied
-- into employees.must_change_password (+ the legacy employee_credentials flag).
-- This service-role RPC clears both once the new password is set, and stamps
-- password_changed_at. Mirrors set_employee_banned's shape/grants.
-- ============================================================================

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
