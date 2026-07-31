-- Fase-1 DB invariant check: Supabase Auth custom claims (plain psql; -v ON_ERROR_STOP=1).
--
-- Verifies that the Access Token Hook resolver (`employee_claims` +
-- `custom_access_token_hook`) produces app_metadata claims IDENTICAL to
-- backend/internal/auth/actor.go `ResolveActor` — the source that RLS
-- (20260723064438) reads via `auth.jwt()->'app_metadata'`. If this drifts, RLS
-- silently mis-scopes every request, so it is gated in CI.
--
-- Depends on the Alpha Digital seed (applied before this script in CI):
--   EMP-0001 Sales/staff · EMP-0006 Sales/lead · EMP-0007 Finance/staff ·
--   EMP-0008/0009/0010 layered Director (no division/level mapping).
--
-- Runs read-only (no writes) — no transaction/rollback needed.

-- 1. employee_claims mirrors ResolveActor for each role shape.
DO $$
DECLARE c jsonb;
BEGIN
  c := public.employee_claims('EMP-0001');
  ASSERT c->>'division' = 'Sales' AND c->>'level' = 'staff'
     AND (c->>'od')::boolean = false AND (c->>'director')::boolean = false,
     format('EMP-0001 (Sales/staff) claims wrong: %s', c);

  c := public.employee_claims('EMP-0006');
  ASSERT c->>'division' = 'Sales' AND c->>'level' = 'lead',
     format('EMP-0006 (Sales/lead) claims wrong: %s', c);

  c := public.employee_claims('EMP-0007');
  ASSERT c->>'division' = 'Finance' AND c->>'level' = 'staff',
     format('EMP-0007 (Finance/staff) claims wrong: %s', c);

  -- Pure Director: no role_mapping ⇒ empty division/level (mirror Go), director=true.
  c := public.employee_claims('EMP-0008');
  ASSERT c->>'division' = '' AND c->>'level' = '' AND (c->>'director')::boolean = true,
     format('EMP-0008 (Director) claims wrong: %s', c);
END $$;

-- 2. custom_access_token_hook injects those claims under app_metadata, keeping
--    pre-existing app_metadata keys (provider/providers) intact.
DO $$
DECLARE ev jsonb; meta jsonb;
BEGIN
  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id', gen_random_uuid(),
          'claims', jsonb_build_object(
             'app_metadata', jsonb_build_object('provider','email','employee_id','EMP-0006'))));
  meta := ev -> 'claims' -> 'app_metadata';
  ASSERT meta->>'employee_id' = 'EMP-0006'
     AND meta->>'division' = 'Sales' AND meta->>'level' = 'lead'
     AND meta->>'provider' = 'email',  -- bawaan app_metadata terjaga
     format('hook did not inject lead claims correctly: %s', meta);

  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id', gen_random_uuid(),
          'claims', jsonb_build_object(
             'app_metadata', jsonb_build_object('employee_id','EMP-0008'))));
  meta := ev -> 'claims' -> 'app_metadata';
  ASSERT (meta->>'director')::boolean = true AND meta->>'division' = '',
     format('hook did not inject director claims correctly: %s', meta);
END $$;

-- 3. Unknown / unlinked employee ⇒ event returned unchanged (no injection).
DO $$
DECLARE ev jsonb;
BEGIN
  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id', gen_random_uuid(),
          'claims', jsonb_build_object('app_metadata', jsonb_build_object('employee_id','EMP-NOPE'))));
  ASSERT (ev -> 'claims' -> 'app_metadata' ->> 'division') IS NULL,
     'hook must not inject claims for an unknown employee_id';
END $$;

-- 4. Layered role `lead` (20260730170000) — SEORANG karyawan jadi lead tanpa
--    menaikkan semua yang sejabatan dengannya. `role_mappings` berkunci
--    (divisi,jabatan), jadi tanpa mekanisme ini "jadikan X lead" berarti
--    "jadikan setiap X-sejabatan lead" — perluasan izin yang tidak diminta dan
--    tidak terlihat.
--
--    🔴 FIXTURE-NYA DISISIPKAN DI SINI, TIDAK DIWARISI DARI SEED. Versi pertama
--    check ini mencari rekan sejabatan di seed dan membungkus assertion-nya
--    dalam `IF peer IS NOT NULL` — seed tidak punya dua karyawan sejabatan,
--    jadi assertion terpentingnya DI-SKIP dan mutasi "lead kolektif" LOLOS.
--    Hijau karena hampa. Sekarang kedua karyawan dibuat eksplisit, sehingga
--    check ini tidak bisa lolos tanpa menguji apa pun.
DO $$
DECLARE lvl text;
BEGIN
  INSERT INTO public.role_mappings (divisi, jabatan, division, level, created_by)
  VALUES ('ZZ-DEPT', 'ZZ-JABATAN', 'Ads', 'staff', 'AUTH-CHECK');
  INSERT INTO public.employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) VALUES
    ('ZZ-LEAD-A', 'auth check a', 'zz.a@example.test', 'ZZ-DEPT', 'ZZ-JABATAN', true, 'AUTH-CHECK'),
    ('ZZ-LEAD-B', 'auth check b', 'zz.b@example.test', 'ZZ-DEPT', 'ZZ-JABATAN', true, 'AUTH-CHECK');

  ASSERT public.employee_claims('ZZ-LEAD-A') ->> 'level' = 'staff', 'fixture A harus staff dulu';
  ASSERT public.employee_claims('ZZ-LEAD-B') ->> 'level' = 'staff', 'fixture B harus staff dulu';

  INSERT INTO public.employee_layered_roles (employee_id, role, created_by)
  VALUES ('ZZ-LEAD-A', 'lead', 'AUTH-CHECK');

  lvl := public.employee_claims('ZZ-LEAD-A') ->> 'level';
  ASSERT lvl = 'lead', format('layered lead harus MENANG atas role_mappings.level (dapat %s)', lvl);

  -- INTI CHECK INI. Kalau seseorang menurunkan level kembali ke role_mappings
  -- atau meresolusinya lewat (divisi,jabatan), B ikut jadi lead dan
  -- kepemimpinan berubah jadi kolektif tanpa ada yang memintanya.
  lvl := public.employee_claims('ZZ-LEAD-B') ->> 'level';
  ASSERT lvl = 'staff',
    format('rekan SEJABATAN tidak boleh ikut jadi lead (dapat %s)', lvl);

  -- division tidak boleh ikut bergeser: layered lead hanya menyentuh level.
  ASSERT public.employee_claims('ZZ-LEAD-A') ->> 'division' = 'Ads',
    'layered lead tidak boleh menggeser division';

  -- Bisa dicabut, bukan sekali jalan.
  UPDATE public.employee_layered_roles SET enabled = false
   WHERE employee_id = 'ZZ-LEAD-A' AND role = 'lead';
  ASSERT public.employee_claims('ZZ-LEAD-A') ->> 'level' = 'staff',
    'layered lead enabled=false harus jatuh kembali ke role_mappings.level';

  DELETE FROM public.employee_layered_roles WHERE employee_id IN ('ZZ-LEAD-A','ZZ-LEAD-B');
  DELETE FROM public.employees            WHERE employee_id IN ('ZZ-LEAD-A','ZZ-LEAD-B');
  DELETE FROM public.role_mappings        WHERE divisi = 'ZZ-DEPT' AND jabatan = 'ZZ-JABATAN';
END $$;

\echo 'auth_claims_checks: PASS'
