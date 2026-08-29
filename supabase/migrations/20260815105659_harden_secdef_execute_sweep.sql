-- ===========================================================================
-- BACK-PORT RIWAYAT VERSI — bukan perubahan skema baru (O61).
-- ===========================================================================
-- Pasangan `20260815094622_harden_job_execute_surface.sql` — baca header
-- berkas itu untuk konteks penuh (kenapa back-port ini ada, kenapa nama
-- berkas = version+name live persis bukan timestamp "seharusnya", kenapa aman
-- dijalankan dua kali). Migrasi ini pernah di-apply LANGSUNG ke live sebagai
-- versi+nama `20260815105659 harden_secdef_execute_sweep`, statements di
-- bawah VERBATIM dari `schema_migrations.statements`, nol suntingan.
--
-- Diverifikasi bersama pasangannya: `scripts/db-rebuild.sh --yes` dengan
-- kedua berkas disisipkan menghasilkan ACL fungsi yang identik dengan live
-- untuk seluruh 6 fungsi di bawah, dan gate tabel/entity_prefix/sm_machines/
-- notif_events TIDAK berubah — nol tabel/kolom/fungsi baru, murni ACL.
-- ===========================================================================

-- 🔴 KEAMANAN — SWEEP: enam fungsi SECURITY DEFINER sisa yang masih bisa
--    dieksekusi anon/authenticated di produksi. Lanjutan 20260815094622.
--
-- Survei pemanggil membuktikan keenamnya TIDAK sekelas:
--
-- GRUP A — penulis internal, dipanggil HANYA dari dalam fungsi SQL lain
--          (wrr_aggregate memanggil ketiga helper; wrr_monday_job dan trigger
--          hold memanggil wrr_aggregate). Panggilan bersarang berjalan sebagai
--          DEFINER, jadi pencabutan tidak memutus rantainya. NOL call site
--          TypeScript di seluruh repo. ⇒ service_role saja.
--
-- GRUP B — helper PREDIKAT RLS. jwt_owns_interview_am dipakai 8 policy,
--          jwt_owns_client_am 2 policy — kesepuluhnya `TO authenticated`.
--          authenticated WAJIB tetap punya EXECUTE atau setiap baca Interview
--          dan rekap mingguan gagal. anon tidak pernah mengevaluasi policy
--          `TO authenticated`. ⇒ anon dicabut, authenticated dipertahankan.
--
-- Menyamaratakan Grup B dengan Grup A adalah cara mematikan halaman yang sedang
-- berfungsi — itulah alasan sweep ini dipisah dari 20260815094622.

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.wrr_aggregate(text)',
    'public.wrr__upsert_metrik(text, text, numeric)',
    'public.wrr__upsert_divisi(text, text, integer, jsonb)',
    'public.wrr__brief_movement(text, text, date, date)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.jwt_owns_client_am(text)',
    'public.jwt_owns_interview_am(text)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman DUA ARAH. Arah kedua yang paling penting: tanpa itu, sweep
-- yang kelewat bersemangat akan mematikan baca Interview/rekap sambil
-- melaporkan "sukses".
DO $$
DECLARE bocor text; mati text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bocor
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('wrr_aggregate','wrr__upsert_metrik','wrr__upsert_divisi','wrr__brief_movement')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bocor IS NOT NULL THEN
    RAISE EXCEPTION 'Grup A masih terbuka untuk anon/authenticated: %', bocor;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO bocor
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('jwt_owns_client_am','jwt_owns_interview_am')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bocor IS NOT NULL THEN
    RAISE EXCEPTION 'Grup B masih terbuka untuk anon: %', bocor;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO mati
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('jwt_owns_client_am','jwt_owns_interview_am')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF mati IS NOT NULL THEN
    RAISE EXCEPTION 'Grup B KEHILANGAN EXECUTE untuk authenticated (baca Interview/rekap akan mati): %', mati;
  END IF;
END $$;
