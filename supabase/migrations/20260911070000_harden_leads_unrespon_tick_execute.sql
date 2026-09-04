-- CDPS — 🔴 KEAMANAN: kunci EXECUTE `leads_unrespon_tick` yang terbuka untuk
-- `anon`/`authenticated` di produksi.
--
-- Ditemukan 2026-09-04 lewat `get_advisors security` SEGERA SESUDAH apply
-- `20260911060000_m1_unrespon_tick.sql` ke `CDPS SG` — dua temuan baru
-- (`anon_security_definer_function_executable` +
-- `authenticated_security_definer_function_executable`) yang tidak ada di
-- baseline sebelum apply. Sekali lagi tidak ada satu test pun yang merah
-- karenanya: Postgres polos CI/lokal tidak memasang default privileges
-- Supabase, jadi cacat kelas ini HANYA bisa muncul di produksi.
--
-- Sebabnya persis sama dengan `20260831090000_harden_m16_tick_execute.sql`:
-- migrasi L3 hanya menulis `REVOKE EXECUTE ... FROM PUBLIC`, sementara proyek
-- Supabase memasang `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS
-- TO anon, authenticated` — hibah eksplisit PER-ROLE yang REVOKE FROM PUBLIC
-- tidak menyentuh. Idiom rumah yang benar (sejak `20260723064826`) HARUS
-- menyebut rolenya secara eksplisit. Ini pengulangan ketiga dari cacat yang
-- sama; itulah persis lubang yang O72 catat: ditambal berulang, tanpa
-- penjaga yang bisa membuatnya merah di CI kalau kembali.
--
-- DAMPAK tanpa fix ini: `leads_unrespon_tick` SECURITY DEFINER, MENULIS
-- `prospect_attempts` (lewat sm_transition), `audit_log`,
-- `prospect_attempt_nq_reasons`, dan `notifications`. Siapa pun TANPA login
-- bisa memicunya kapan saja lewat `/rest/v1/rpc/leads_unrespon_tick` — dan
-- karena `p_now` adalah parameter, penyerang bisa MENGOPER TANGGAL MASA DEPAN
-- lalu menua-paksa SELURUH pipeline lead ke `[Unrespon]` dan `Not Qualified`
-- sekaligus. Transisinya immutable di `audit_log`; tidak ada tombol undo.
--
-- NOL perubahan untuk pemanggil sah: pg_cron jalan sebagai owner (postgres),
-- route `POST /api/v1/internal/leads/tick` memakai koneksi `DATABASE_URL`
-- (owner), bukan PostgREST. Berkas ini MENYEMPITKAN saja.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.leads_unrespon_tick(timestamptz)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman: kalau masih terbuka, GAGALKAN migrasinya alih-alih
-- melaporkan sukses palsu (pola persis 20260814130000/20260831090000).
DO $$
DECLARE
  bocor text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO bocor
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('leads_unrespon_tick')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bocor IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTE masih terbuka untuk anon/authenticated pada: %', bocor;
  END IF;
END $$;
