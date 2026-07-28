-- ============================================================================
-- BACK-PORT (C-03 / DECISIONS O38 opsi A) — verbatim dari project live `CDPS SG`,
-- versi remote `20260727072443_harden_secdef_helpers_to_private_schema`.
--
-- INI migrasi yang menyebabkan blocker C03-F1: ia memindahkan `jwt_owns_*` dari
-- `public` ke `private` di produksi, sementara repo masih menganggapnya ada di
-- `public`. Akibatnya migrasi C-01 (`…_rls_leads_campaign_scope`) gagal apply ke
-- live dengan `ERROR: function jwt_owns_lead(character varying) does not exist`.
-- Dengan back-port ini, repo dan live memakai definisi yang sama, dan migrasi
-- C-01 (kini 20260102000009) sudah disesuaikan memakai `private.*`.
--
-- Latar remediasi advisor: `docs/handoff/SUPABASE_SECURITY_HARDENING_20260727.md`.
-- URUTAN PENTING: harus berjalan SETELAH rls_baseline (…0003) yang membuat
-- `jwt_owns_*`, setelah employee_display_name (…0006), dan SEBELUM …0009.
-- ============================================================================

-- Advisor 0029: move the 4 SECURITY DEFINER helpers out of the PostgREST-exposed
-- `public` schema into an unexposed `private` schema. SET SCHEMA preserves each
-- function's OID, so the 13 RLS SELECT policies that reference jwt_owns_* follow
-- automatically — RLS behaviour is unchanged, only the /rest/v1/rpc surface is
-- removed. apps/api connects as a privileged/service role and does not call these
-- via PostgREST, so nothing in the app path is affected.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

alter function public.employee_display_name(text) set schema private;
alter function public.jwt_owns_client(text)       set schema private;
alter function public.jwt_owns_lead(text)         set schema private;
alter function public.jwt_owns_transaction(text)  set schema private;

-- jwt_owns_transaction's body called public.jwt_owns_client explicitly; repoint it
-- to the relocated function. CREATE OR REPLACE keeps the same OID → policies stay
-- bound (installments/transactions).
create or replace function private.jwt_owns_transaction(p_txn_id text)
returns boolean language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select exists (
    select 1 from public.transactions t
    where t.id = p_txn_id
      and (t.created_by = public.jwt_employee_id() or private.jwt_owns_client(t.client_id))
  )
$$;

-- Belt-and-suspenders: anon must never call these (authenticated keeps EXECUTE so
-- the policies can still evaluate; the schema is unexposed so there is no RPC path).
revoke execute on function
  private.employee_display_name(text),
  private.jwt_owns_client(text),
  private.jwt_owns_lead(text),
  private.jwt_owns_transaction(text)
from anon;
