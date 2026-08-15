-- 🔴 KEAMANAN — SWEEP: enam fungsi `SECURITY DEFINER` sisa yang masih bisa
--    dieksekusi `anon`/`authenticated` di produksi.
--
-- Lanjutan `20260814130000` (tiga fungsi job). Berkas itu sengaja berhenti di
-- tiga karena keenam sisanya butuh survei pemanggil dulu — dan survei itu
-- membuktikan keenamnya TIDAK boleh diperlakukan sama. Berkas ini menyelesaikan
-- sisanya, dengan pembagian yang survei itu hasilkan.
--
-- ---------------------------------------------------------------------------
-- KENAPA `REVOKE ... FROM PUBLIC` TIDAK CUKUP (sama seperti 20260814130000)
-- ---------------------------------------------------------------------------
-- Supabase memasang `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE
-- ON FUNCTIONS TO anon, authenticated`, yang membuat hibah EKSPLISIT per-role
-- pada setiap fungsi baru. Mencabut PUBLIC tidak menyentuhnya. Idiom rumah yang
-- benar MENYEBUT rolenya. Postgres polos (CI + db-rebuild.sh) tidak punya
-- default privileges itu, jadi kelas cacat ini hanya ada di produksi dan tidak
-- pernah bisa merah di CI — lihat catatan gerbang di bawah.
--
-- ---------------------------------------------------------------------------
-- SURVEI PEMANGGIL — dan kenapa keenamnya TIDAK sekelas
-- ---------------------------------------------------------------------------
-- GRUP A — penulis internal, dipanggil HANYA dari dalam fungsi SQL lain
--          (`wrr_aggregate` memanggil ketiga helper; `wrr_monday_job` dan
--          trigger hold memanggil `wrr_aggregate`). Panggilan bersarang itu
--          berjalan sebagai DEFINER, jadi mencabut anon/authenticated tidak
--          memutus rantainya. NOL call site TypeScript di seluruh repo (yang
--          ada hanya berkas test, dan test tersambung sebagai owner migrasi).
--          ⇒ service_role saja.
--            wrr_aggregate(text)
--            wrr__upsert_metrik(text, text, numeric)
--            wrr__upsert_divisi(text, text, integer, jsonb)
--            wrr__brief_movement(text, text, date, date)
--
-- GRUP B — helper PREDIKAT RLS. `jwt_owns_interview_am` dipakai 8 policy,
--          `jwt_owns_client_am` 2 policy — dan **kesepuluh policy itu `TO
--          authenticated`**. Artinya `authenticated` WAJIB tetap punya EXECUTE:
--          mencabutnya akan membuat SETIAP baca Interview dan rekap mingguan
--          gagal. `anon` tidak pernah mengevaluasi policy `TO authenticated`,
--          jadi hanya `anon` yang dicabut. Pola identik `jwt_owns_client` /
--          `jwt_owns_transaction` / `jwt_owns_lead` di `20260723064826`.
--          ⇒ anon DICABUT, authenticated DIPERTAHANKAN.
--            jwt_owns_client_am(text)
--            jwt_owns_interview_am(text)
--
-- Menyamaratakan Grup B dengan Grup A adalah cara mematikan halaman yang sedang
-- berfungsi. Itulah alasan sweep ini tidak ditumpangkan ke 20260814130000.
--
-- Idempoten: REVOKE/GRANT menetapkan keadaan akhir. `to_regprocedure(...) IS
-- NOT NULL` supaya berkas ini tetap apply di DB yang dibangun sebelum M6D /
-- Interview ada.

-- ===========================================================================
-- GRUP A — penulis internal ⇒ service_role saja.
-- ===========================================================================
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

-- ===========================================================================
-- GRUP B — helper predikat RLS ⇒ anon dicabut, authenticated DIPERTAHANKAN.
-- ===========================================================================
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.jwt_owns_client_am(text)',
    'public.jwt_owns_interview_am(text)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      -- `anon` saja. GRANT authenticated ditulis ULANG secara eksplisit supaya
      -- niatnya terbaca di berkas ini, bukan tersirat dari default privileges.
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ===========================================================================
-- SABUK PENGAMAN — dua arah, dan arah KEDUA yang paling penting.
--
--   (1) Grup A tidak boleh tersisa terbuka untuk anon/authenticated.
--   (2) Grup B HARUS TETAP bisa dieksekusi `authenticated`.
--
-- Tanpa (2), sweep yang kelewat bersemangat akan mematikan baca Interview dan
-- rekap mingguan sambil melaporkan "sukses" — persis mode gagal yang membuat
-- sweep ini dipisah dari 20260814130000.
-- ===========================================================================
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
