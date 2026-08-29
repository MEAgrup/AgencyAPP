-- CDPS — 🔴 KEAMANAN: kunci EXECUTE dua fungsi job SECURITY DEFINER M16 yang
-- terbuka untuk `anon`/`authenticated` di produksi.
--
-- Ditemukan saat push migrasi M16/M17 ke `CDPS SG` (2026-08-29) via
-- `mcp__Supabase__get_advisors` — bukan dari membaca kode, dan tidak ada satu
-- test pun yang merah karenanya (Postgres polos CI/lokal tidak punya default
-- privileges Supabase, jadi cacat ini hanya pernah bisa muncul di produksi).
--
-- `stage_overdue_tick` (`20260830030000_m16_stage_notif_tick.sql`) hanya
-- menulis `REVOKE EXECUTE ... FROM PUBLIC`, dan `permintaan_reminder_tick`
-- (`20260831050000_req_reminder_tick.sql`) sudah menulis REVOKE FROM PUBLIC +
-- GRANT TO service_role — TAPI KEDUANYA tetap tampil `anon`/`authenticated`
-- executable di advisor. Alasannya sama persis dengan
-- `20260814130000_harden_job_execute_surface.sql`: proyek Supabase memasang
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated`, hibah eksplisit PER-ROLE pada tiap fungsi baru yang REVOKE
-- FROM PUBLIC tidak menyentuh. Idiom rumah yang benar (sejak
-- `20260723064826`) HARUS menyebut rolenya secara eksplisit.
--
-- DAMPAK: keduanya SECURITY DEFINER dan MENULIS `notifications` (dan, untuk
-- permintaan_reminder_tick, `permintaan.jatuh_tempo_terkirim`). Tanpa fix ini,
-- pihak luar tanpa autentikasi (`stage_overdue_tick`) atau siapa pun yang
-- login (keduanya) bisa memicu job ini kapan saja lewat
-- `/rest/v1/rpc/<nama_fungsi>` — spam notifikasi dan mengunci idempotensi
-- `jatuh_tempo_terkirim` lebih awal dari jadwal cron sebenarnya.
--
-- NOL perubahan untuk pemanggil sah: pg_cron jalan sebagai owner (postgres),
-- route internal (kalau ada) memakai service-role. Berkas ini MENYEMPITKAN
-- saja — sama seperti kedua migrasi hardening 2026-08-14/15 yang jadi
-- rujukannya.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.stage_overdue_tick(timestamptz)',
    'public.permintaan_reminder_tick(timestamptz)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman: kalau salah satu masih terbuka, GAGALKAN migrasinya alih-alih
-- melaporkan sukses palsu (pola persis 20260814130000/20260814140000).
DO $$
DECLARE
  bocor text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO bocor
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('stage_overdue_tick', 'permintaan_reminder_tick')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bocor IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTE masih terbuka untuk anon/authenticated pada: %', bocor;
  END IF;
END $$;
