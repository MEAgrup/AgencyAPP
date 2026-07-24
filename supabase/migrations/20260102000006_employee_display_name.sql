-- ============================================================================
-- employee_display_name(id) — RLS-safe owner/PIC name resolver (O37).
--
-- Read routes now run as `authenticated` (see O37 / apps/api readAs), so the RLS
-- policy on `public.employees` restricts a caller to their own row (+ created +
-- read-all roles). List/detail reads that show ANOTHER person's name (pool board
-- owner, client sales PIC, proposal author, …) would otherwise lose the name to
-- RLS and fall back to the raw NIK. This SECURITY DEFINER function resolves ONLY
-- the display name (nama) for a given employee_id, bypassing row RLS for that
-- single non-sensitive field — it never exposes email/status or any other column,
-- and returns the id itself when unknown (same graceful fallback the old
-- `coalesce(e.nama, id)` join gave). search_path is locked (advisor
-- function_search_path_mutable).
-- ============================================================================

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

-- Callable on the read path (authenticated) and by service-role/system reads.
REVOKE ALL ON FUNCTION public.employee_display_name(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.employee_display_name(text) TO authenticated, service_role;
