-- 🔴 KEAMANAN — kunci EXECUTE tiga fungsi job SECURITY DEFINER yang terbuka
--    untuk `anon` dan `authenticated` di produksi.
--
-- ---------------------------------------------------------------------------
-- TEMUAN
-- ---------------------------------------------------------------------------
-- Ditemukan saat memverifikasi apply `20260814110000`/`20260814120000` ke
-- `CDPS SG` (2026-08-14), dengan membaca `proacl` live — BUKAN dari membaca
-- kode, dan tidak ada satu test pun yang merah karenanya.
--
--   penugasan_reminder_tick   {postgres=X, anon=X, authenticated=X, service_role=X}
--   wrr_reminder_tick         {postgres=X, anon=X, authenticated=X, service_role=X}
--   wrr_monday_job            {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- Bandingkan dengan engine yang MEMANG sudah dikunci `20260723064826`:
--
--   notify_emit / sm_transition   {postgres=X, service_role=X}
--
-- ---------------------------------------------------------------------------
-- KENAPA `REVOKE ... FROM PUBLIC` TIDAK CUKUP (inti pelajarannya)
-- ---------------------------------------------------------------------------
-- Ketiga migrasi job menulis `REVOKE EXECUTE ... FROM PUBLIC` lalu `GRANT ...
-- TO service_role`, dan itu TERLIHAT benar. Tapi proyek Supabase memasang
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO
-- anon, authenticated` — yang membuat hibah **eksplisit per-role** pada setiap
-- fungsi baru. Mencabut PUBLIC tidak menyentuh hibah eksplisit itu sama sekali.
--
-- Karena itu idiom rumah yang benar (dan yang dipakai `20260723064826`) MENYEBUT
-- rolenya: `FROM public, anon, authenticated`. Berkas ini menerapkan idiom itu
-- ke tiga fungsi yang terlewat.
--
-- Ini juga sebabnya cacat kelas ini tidak pernah merah di CI: Postgres polos
-- (CI + `scripts/db-rebuild.sh`) TIDAK punya default privileges Supabase, jadi
-- di sana ACL-nya memang sudah bersih. Ia hanya ada di produksi.
--
-- ---------------------------------------------------------------------------
-- DAMPAK YANG DITUTUP
-- ---------------------------------------------------------------------------
-- Ketiganya SECURITY DEFINER dan MENULIS. Siapa pun yang memegang anon key
-- publik bisa memanggilnya:
--   * `penugasan_reminder_tick()` / `wrr_reminder_tick()` — memaksa emisi
--     notifikasi lebih awal dan MEMBAKAR penanda idempotensinya, sehingga
--     pengingat yang sah tidak pernah terkirim lagi (penandanya searah).
--   * `wrr_monday_job()` — jauh lebih berat: MEMBUKA rekap, dan FORCE-CLOSE
--     rekap minggu lalu (`Terbuka → Ditutup Otomatis`) sambil menyalakan
--     `pernah_ditutup_otomatis` yang permanen — dan flag itu MENURUNKAN skor
--     Disiplin Rekap AM di M14 (D-14/RM-9a). Jadi pihak luar bisa merusak angka
--     performa orang, permanen, tanpa autentikasi.
--
-- Tidak ada bukti hal ini pernah dieksploitasi; ini penutupan permukaan.
--
-- ---------------------------------------------------------------------------
-- NOL PERUBAHAN PERILAKU UNTUK PEMANGGIL YANG SAH
-- ---------------------------------------------------------------------------
-- pg_cron menjalankan job sebagai owner (`postgres`), dan route internal
-- (`/api/v1/internal/**`) memakai koneksi service-role. Keduanya tetap `X`.
-- Berkas ini MENYEMPITKAN saja — tidak ada GRANT baru ke siapa pun.
--
-- Idempoten: REVOKE/GRANT menetapkan keadaan akhir, bukan delta. `IF EXISTS`
-- pada tiap fungsi supaya berkas ini tetap apply di DB yang dibangun sebelum
-- M6D D-06 ada.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.penugasan_reminder_tick(timestamptz)',
    'public.wrr_reminder_tick(timestamptz)',
    'public.wrr_monday_job(timestamptz)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      -- Menyebut anon/authenticated EKSPLISIT — itulah perbaikannya.
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman: kalau salah satu masih bisa dieksekusi anon/authenticated
-- sesudah blok di atas, GAGALKAN migrasinya alih-alih melaporkan sukses palsu.
DO $$
DECLARE
  bocor text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO bocor
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('penugasan_reminder_tick', 'wrr_reminder_tick', 'wrr_monday_job')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bocor IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTE masih terbuka untuk anon/authenticated pada: %', bocor;
  END IF;
END $$;
