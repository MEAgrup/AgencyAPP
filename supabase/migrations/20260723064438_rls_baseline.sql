-- ============================================================================
-- Fase 1 — RLS baseline (Row Level Security) untuk seluruh skema CDPS.
--
-- Ref:
--   docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §D (desain RLS), §B.3 (immutability),
--   §D.3 (service-role vs RLS), PERMISSIONS.md, packages/core/src/permission.ts.
--
-- Prinsip (mirror predikat permission.ts — DUA implementasi tak boleh divergen):
--   Staff    = data milik sendiri (owner_col = employee_id dari JWT).
--   Lead/SPV = seluruh divisi sendiri (division_col = jwt_division()).
--   OD       = read-only di mana-mana (canReadAll) — HANYA di policy SELECT.
--   Director = full akses (read & write) — write TETAP lewat RPC/service-role.
--
-- Model penulisan (§D.3): tabel domain TIDAK diberi policy INSERT/UPDATE/DELETE
-- untuk `authenticated`. Penulisan status HANYA lewat sm_transition, alokasi ID
-- lewat ident_next, notifikasi lewat notify_emit — semuanya SECURITY DEFINER RPC
-- (di-set di bawah) atau job service-role. RLS di sini adalah jaring pengaman
-- BACA (mencegah IDOR / cross-scope read) + default-deny untuk semua tulis klien.
--
-- Grant hygiene: `anon` (belum login / realm publik) dicabut TOTAL dari semua tabel
-- internal ini — CDPS internal hanya untuk `authenticated`. `authenticated` hanya
-- diberi SELECT (di-filter RLS); semua tulis dicabut. `service_role` (BYPASSRLS)
-- tidak disentuh — dipakai job batch & RPC SECURITY DEFINER.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Portabilitas stack: pada Supabase asli, role `anon/authenticated/
--    service_role` dan fungsi `auth.jwt()` SUDAH ADA. Pada stack polos
--    (mis. `postgres:17` di CI, apply migrasi lokal) tidak ada → CREATE
--    FUNCTION/GRANT di bawah akan gagal validasi. Buat shim minimal bila absen
--    supaya migrasi RLS bisa di-apply & diuji di mana saja. Semua guarded
--    IF NOT EXISTS → no-op di Supabase (tidak menyentuh `auth.jwt()` bawaan).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    EXECUTE 'CREATE SCHEMA auth';
  END IF;
  -- auth.jwt(): Supabase membacanya dari GUC `request.jwt.claims`. Reimplementasi
  -- kompatibel HANYA bila fungsi belum ada (di Supabase blok ini dilewati).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'jwt'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $q$ SELECT coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb,
            '{}'::jsonb) $q$;
    $fn$;
    -- Supabase memberi USAGE/EXECUTE ini di stack aslinya; shim menirunya supaya
    -- policy RLS bisa memanggil auth.jwt() sebagai `authenticated`/`anon`.
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Helper accessor klaim JWT app_metadata (§D.1) — STABLE, dibaca semua policy.
--    app_metadata (BUKAN user_metadata) karena user_metadata bisa diedit user.
--    search_path dikunci (advisor `function_search_path_mutable`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_employee_id() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT auth.jwt() -> 'app_metadata' ->> 'employee_id' $$;

CREATE OR REPLACE FUNCTION public.jwt_division() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT auth.jwt() -> 'app_metadata' ->> 'division' $$;

CREATE OR REPLACE FUNCTION public.jwt_is_lead() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'level') = 'lead', false) $$;

CREATE OR REPLACE FUNCTION public.jwt_is_od() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'od')::boolean, false) $$;

CREATE OR REPLACE FUNCTION public.jwt_is_director() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'director')::boolean, false) $$;

-- canReadAll (permission.ts): Director ATAU OD lihat lintas-divisi.
CREATE OR REPLACE FUNCTION public.jwt_can_read_all() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS
$$ SELECT public.jwt_is_director() OR public.jwt_is_od() $$;

-- ---------------------------------------------------------------------------
-- 2. Helper kepemilikan lewat parent (SECURITY DEFINER) — dipakai policy tabel
--    anak yang scope-nya diturunkan dari client/transaction/lead induknya.
--    SECURITY DEFINER supaya subquery tidak ikut ter-filter RLS tabel induk
--    (menghindari saling-recursion & under-expose ganda). search_path dikunci.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_owns_client(p_client_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id
      AND public.jwt_employee_id() IN
          (c.sales_pic_id, c.assigned_am_id, c.commission_payment_pic_id, c.created_by)
  )
$$;

CREATE OR REPLACE FUNCTION public.jwt_owns_transaction(p_txn_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = p_txn_id
      AND (t.created_by = public.jwt_employee_id() OR public.jwt_owns_client(t.client_id))
  )
$$;

CREATE OR REPLACE FUNCTION public.jwt_owns_lead(p_lead_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.prospect_attempts pa
    WHERE pa.lead_id = p_lead_id
      AND pa.owner_employee_id = public.jwt_employee_id()
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. House-engine functions → SECURITY DEFINER (§D.3) + search_path dikunci.
--    Supaya alokasi ID / transisi / notifikasi lintas-scope tetap jalan saat
--    dipanggil sebagai RPC oleh koneksi `authenticated` (RLS aktif). Otorisasi
--    "siapa boleh apa" tetap dicek EKSPLISIT di dalam fungsi (parameter role),
--    bukan diserahkan ke RLS caller.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.ident_next(text, timestamptz)
  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.sm_transition(text, text, text, text, text, text, text, text, boolean, boolean)
  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_emit(text, text, text, text, text, text, text[], boolean)
  SECURITY DEFINER SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 4. Cabut akses `anon` dari SEMUA tabel publik (CDPS internal = authenticated).
--    `authenticated` di-reset lalu hanya diberi SELECT (RLS memfilter baris);
--    semua penulisan lewat RPC/service-role. Tabel internal murni (grup 6)
--    dicabut total dari authenticated juga — lihat blok berikutnya.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Tabel internal murni: RLS aktif + TANPA policy (default-deny) + SELECT
--    dicabut lagi dari authenticated. Hanya diakses fungsi SECURITY DEFINER
--    (owner postgres, BYPASSRLS) & service_role. Termasuk kolom sensitif
--    (sessions.token, employee_credentials.password_hash, id_sequences).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
      'sessions','id_sequences','employee_credentials',
      'role_mappings','employee_layered_roles',
      'sm_machines','sm_edges','sm_terminal_states','notif_events'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated;', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Tabel append-only / immutable (§B.3): defense-in-depth REVOKE UPDATE,DELETE
--    (di atas trigger forbid_mutation). SELECT tetap, difilter policy grup 8.
--    (authenticated sudah hanya punya SELECT dari grup 4; REVOKE ini eksplisit
--    sebagai dokumentasi niat + jaga bila grant berubah.)
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON
  public.audit_log, public.notifications,
  public.client_health_snapshots, public.performance_snapshots
FROM anon, authenticated;

-- ===========================================================================
-- 7. POLICY SELECT — tabel domain. Pola: canReadAll OR <owner> [OR <divisi>]
--    [OR <parent-owner>]. Semua FOR SELECT TO authenticated.
-- ===========================================================================

-- ---- Karyawan & admin --------------------------------------------------
-- employees: direktori. Director/OD lihat semua; karyawan lihat baris sendiri.
-- (employees.divisi = divisi HRIS mentah, BUKAN CDPS division → tak dipakai
--  untuk scope lead; under-expose aman.)
CREATE POLICY employees_select ON public.employees FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR employee_id = jwt_employee_id()
       OR created_by = jwt_employee_id());

-- ---- Master Service List (katalog) ------------------------------------
-- Dibutuhkan semua staff untuk menyusun qualified form/kontrak → baca bebas
-- (authenticated). Tulis lewat admin RPC (Director) — tak ada write policy.
CREATE POLICY master_services_select ON public.master_services FOR SELECT TO authenticated
USING (true);
CREATE POLICY master_service_versions_select ON public.master_service_versions FOR SELECT TO authenticated
USING (true);

-- ---- Konfigurasi performa / OKR (domain OD/Director) ------------------
CREATE POLICY perf_kpi_weights_select ON public.perf_kpi_weights FOR SELECT TO authenticated
USING (jwt_can_read_all());
CREATE POLICY perf_period_targets_select ON public.perf_period_targets FOR SELECT TO authenticated
USING (jwt_can_read_all());

-- ---- Demo/seed tasks (punya kolom division) ---------------------------
CREATE POLICY demo_tasks_select ON public.demo_tasks FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND division = jwt_division()));
CREATE POLICY demo_task_block_requests_select ON public.demo_task_block_requests FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (requested_by, resolved_by, created_by));

-- ---- M1 Leads / prospek -----------------------------------------------
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND origin_division = jwt_division())
       OR jwt_owns_lead(id));
CREATE POLICY prospect_attempts_select ON public.prospect_attempts FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (owner_employee_id, created_by)
       OR jwt_owns_lead(lead_id));
CREATE POLICY prospect_attempt_nq_reasons_select ON public.prospect_attempt_nq_reasons FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id());
CREATE POLICY negotiation_proposals_select ON public.negotiation_proposals FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (proposed_by, created_by));
CREATE POLICY negotiation_proposal_lines_select ON public.negotiation_proposal_lines FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id());

-- ---- M4/M5 Clients, services, keuangan --------------------------------
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (sales_pic_id, assigned_am_id, commission_payment_pic_id, created_by));
CREATE POLICY client_platforms_select ON public.client_platforms FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id() OR jwt_owns_client(client_id));
CREATE POLICY client_sales_allocations_select ON public.client_sales_allocations FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id() OR jwt_owns_client(client_id));
CREATE POLICY services_select ON public.services FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id() OR jwt_owns_client(client_id));

-- transactions/installments/payment_verifications: Finance lead lihat divisi
-- Finance; PIC klien lihat lewat parent; tulis payment_status HANYA via RPC.
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND jwt_division() = 'Finance')
       OR jwt_owns_client(client_id));
CREATE POLICY installments_select ON public.installments FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (verified_by, created_by)
       OR (jwt_is_lead() AND jwt_division() = 'Finance')
       OR jwt_owns_transaction(transaction_id));
CREATE POLICY payment_verifications_select ON public.payment_verifications FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (verified_by, created_by)
       OR (jwt_is_lead() AND jwt_division() = 'Finance'));
CREATE POLICY transaction_issue_approvals_select ON public.transaction_issue_approvals FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND division = jwt_division()));

-- qualified_forms (+ services child): owner = pembuat form.
CREATE POLICY qualified_forms_select ON public.qualified_forms FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR jwt_owns_lead(lead_id));
CREATE POLICY qualified_form_services_select ON public.qualified_form_services FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id());

-- ---- M6 Briefs & strategy ---------------------------------------------
CREATE POLICY briefs_select ON public.briefs FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (assigned_pic, created_by)
       OR (jwt_is_lead() AND assigned_division = jwt_division()));
CREATE POLICY brief_block_requests_select ON public.brief_block_requests FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (requested_by, resolved_by, created_by));
CREATE POLICY strategy_plans_select ON public.strategy_plans FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (approved_by, created_by));

-- ---- M13 Complaints ----------------------------------------------------
CREATE POLICY complaints_select ON public.complaints FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (assigned_to, created_by)
       OR jwt_owns_client(client_id));

-- ---- M7 Creative assets ------------------------------------------------
CREATE POLICY assets_select ON public.assets FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (assigned_pic, created_by));
CREATE POLICY asset_block_requests_select ON public.asset_block_requests FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (requested_by, resolved_by, created_by));

-- ---- M8 Ads ------------------------------------------------------------
CREATE POLICY ad_campaigns_select ON public.ad_campaigns FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id() OR jwt_owns_client(client_id));
CREATE POLICY ad_campaign_assets_select ON public.ad_campaign_assets FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id());
CREATE POLICY metric_entries_select ON public.metric_entries FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (entered_by, created_by));
-- metric_entry_assets: junction murni (metric_entry_id, asset_id) — tanpa kolom
-- owner. Scope diturunkan dari parent metric_entries (RLS-nya ikut memfilter).
CREATE POLICY metric_entry_assets_select ON public.metric_entry_assets FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR EXISTS (SELECT 1 FROM public.metric_entries me
                  WHERE me.id = metric_entry_assets.metric_entry_id
                    AND jwt_employee_id() IN (me.entered_by, me.created_by)));
CREATE POLICY optimization_logs_select ON public.optimization_logs FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (actor, created_by));

-- ---- M9 KOL / creators -------------------------------------------------
CREATE POLICY creator_bookings_select ON public.creator_bookings FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (assigned_coordinator, created_by));
CREATE POLICY creator_payment_requests_select ON public.creator_payment_requests FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (requested_by, paid_by, created_by));
CREATE POLICY creator_lists_select ON public.creator_lists FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id());

-- ---- M10 Live stream ---------------------------------------------------
CREATE POLICY live_stream_sessions_select ON public.live_stream_sessions FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id());

-- ---- M11/M12 Campaigns & performance records ---------------------------
CREATE POLICY campaigns_select ON public.campaigns FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (owner_employee_id, created_by));
CREATE POLICY marketing_performance_records_select ON public.marketing_performance_records FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id());
CREATE POLICY dependencies_select ON public.dependencies FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id() OR jwt_owns_client(client_id));

-- ===========================================================================
-- 8. POLICY SELECT — tabel append-only / immutable & personal.
-- ===========================================================================

-- audit_log: oversight (Director/OD) + aktor lihat aksinya sendiri.
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
USING (jwt_can_read_all() OR actor_employee_id = jwt_employee_id());

-- notifications: personal — HANYA penerima. Director/OD TIDAK membaca notifikasi
-- orang lain (bukan data oversight). read_at diubah lewat RPC (tak ada write policy).
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
USING (recipient_employee_id = jwt_employee_id());

-- client_health_snapshots (§D.2): Director/OD + Account lead + PIC klien.
CREATE POLICY client_health_snapshots_select ON public.client_health_snapshots FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR jwt_owns_client(client_id));

-- performance_snapshots: skor performa — Director/OD + karyawan subjeknya.
CREATE POLICY performance_snapshots_select ON public.performance_snapshots FOR SELECT TO authenticated
USING (jwt_can_read_all() OR staff_id = jwt_employee_id());

-- ===========================================================================
-- 9. Hardening permukaan EXECUTE (advisor 0028/0029) + retrofit search_path.
-- ===========================================================================

-- House-engine functions dipanggil SERVER-SIDE lewat executor `@cdps/db`
-- (koneksi service-role/privileged), BUKAN sebagai RPC PostgREST publik. Cabut
-- EXECUTE dari `public`/`anon`/`authenticated` supaya tak bisa dipanggil langsung
-- via `/rest/v1/rpc/*` — kalau bisa, `anon` dapat memanggil `sm_transition`
-- dengan `p_role_director := true` dan MELEWATI gate role. Hanya `service_role`
-- (dan pemilik fungsi) yang boleh — otorisasi tetap di API handler.
REVOKE EXECUTE ON FUNCTION public.ident_next(text, timestamptz) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sm_transition(text, text, text, text, text, text, text, text, boolean, boolean) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, text, text, text, text, text, text[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ident_next(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_transition(text, text, text, text, text, text, text, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, text, text, text, text, text, text[], boolean) TO service_role;

-- Policy-helper SECURITY DEFINER: dipakai DI DALAM policy RLS → `authenticated`
-- WAJIB boleh EXECUTE (eval policy butuh privilege EXECUTE). Cabut dari `public`
-- DAN `anon` (Supabase memberi grant langsung ke anon/authenticated via default
-- privileges, jadi REVOKE FROM public saja tak cukup) — `anon` tak pernah kena
-- policy domain (tak punya grant SELECT), jadi tak butuh helper ini.
--
-- Sisa advisor 0029 (authenticated boleh EXECUTE helper ini via /rpc) DITERIMA:
-- fungsi hanya mengembalikan boolean "apakah pemanggil sendiri memiliki X",
-- diturunkan dari klaim JWT si pemanggil — tak membocorkan data lintas-tenant.
-- Pengerasan lanjutan (pindah ke schema privat tak ter-expose PostgREST) dicatat
-- di docs/DECISIONS.md 2026-07-23 sebagai follow-up.
REVOKE EXECUTE ON FUNCTION public.jwt_owns_client(text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_transaction(text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_lead(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jwt_owns_client(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jwt_owns_transaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jwt_owns_lead(text) TO authenticated;

-- Retrofit search_path fungsi fondasi lama (advisor 0011 `function_search_path_
-- mutable`). Semua hanya menyentuh objek `public` → path public,pg_temp aman.
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.forbid_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.wib_date(timestamptz) SET search_path = public, pg_temp;
ALTER FUNCTION public.wib_period(timestamptz) SET search_path = public, pg_temp;
