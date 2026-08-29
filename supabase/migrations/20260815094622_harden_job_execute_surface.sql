-- ===========================================================================
-- BACK-PORT RIWAYAT VERSI — bukan perubahan skema baru (O61).
-- ===========================================================================
-- Berkas ini ada supaya riwayat migrasi repo cocok 1:1 dengan
-- `supabase_migrations.schema_migrations` di `CDPS SG`. Migrasi ini pernah
-- di-apply LANGSUNG ke live (versi + nama `20260815094622
-- harden_job_execute_surface`) tanpa padanan berkas di repo — ditemukan saat
-- audit pra-`db push` M16 (`docs/DECISIONS.md` 2026-08-29 "O61"), dicatat
-- sebagai `Open` alih-alih ditutup diam-diam, dan ditutup di sini dengan pola
-- YANG SAMA seperti back-port pertama (`20260723064826_rls_harden_execute_
-- surface.sql`, 2026-07-29): **nama berkas = version+name live persis**, bukan
-- timestamp "seharusnya" yang disebut di komentar aslinya (di sana `2026-08-14`
-- — kapan penulisnya BERMAKSUD menaruhnya, bukan kapan ia benar-benar
-- ter-apply). Menamainya `20260814130000...` akan membuat `supabase db push`
-- melihatnya sebagai migrasi BARU (versi itu tidak ada di `schema_migrations`)
-- dan meng-apply-nya kedua kali dengan version berbeda — persis kelas drift
-- yang berkas ini dimaksudkan menutup, bukan menghilangkannya.
--
-- Isinya di bawah adalah **statements live VERBATIM** (diambil dari
-- `schema_migrations.statements`), nol suntingan — disiplin O38 opsi (A):
-- repo mereproduksi produksi, bukan tafsirannya.
--
-- AMAN DIJALANKAN DUA KALI. Setiap `REVOKE`/`GRANT` menetapkan keadaan akhir,
-- bukan delta, dan ketiga target fungsi dibungkus `to_regprocedure(...) IS NOT
-- NULL` — DB kosong/CI yang belum punya salah satu fungsinya tidak gagal,
-- hanya skip baris itu. Diverifikasi: `scripts/db-rebuild.sh --yes` dengan
-- berkas ini disisipkan menghasilkan ACL fungsi yang identik dengan live
-- (`REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO
-- service_role`), dan gate tabel/entity_prefix/sm_machines/notif_events TIDAK
-- berubah — berkas ini nol tabel/kolom/fungsi baru, murni ACL.
--
-- POSISI TIDAK BOLEH DIGESER. Duduk SESUDAH `20260814120000_penugasan_notif_
-- jatuh_tempo` (yang membuat `penugasan_reminder_tick`) dan `20260813080000_
-- m6d_wrr_job` (yang membuat `wrr_reminder_tick`/`wrr_monday_job`) — ketiga
-- fungsi target sudah ada di titik ini, sama seperti urutan waktu nyata di
-- live. Menomori ulang ke posisi SEBELUM ketiga fungsi itu dibuat tidak akan
-- gagal (guard `to_regprocedure`), tapi akan membuat jendela hardening-nya
-- salah menggambarkan riwayat nyata.
-- ===========================================================================

-- 🔴 KEAMANAN — kunci EXECUTE tiga fungsi job SECURITY DEFINER yang terbuka
--    untuk `anon` dan `authenticated` di produksi.
--
-- Ditemukan saat memverifikasi apply 20260814110000/20260814120000 ke CDPS SG
-- (2026-08-14) dengan membaca `proacl` live — bukan dari membaca kode, dan tidak
-- ada satu test pun yang merah karenanya.
--
-- KENAPA `REVOKE ... FROM PUBLIC` TIDAK CUKUP: proyek Supabase memasang
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`,
-- yang membuat hibah EKSPLISIT per-role pada tiap fungsi baru. Mencabut PUBLIC
-- tidak menyentuhnya. Idiom rumah yang benar (20260723064826) MENYEBUT rolenya.
-- Postgres polos (CI + db-rebuild.sh) tidak punya default privileges itu, jadi
-- cacat ini hanya ada di produksi dan tak pernah bisa merah di CI.
--
-- DAMPAK: ketiganya SECURITY DEFINER dan MENULIS. wrr_monday_job bisa
-- force-close rekap dan menyalakan `pernah_ditutup_otomatis` yang permanen dan
-- MENURUNKAN skor Disiplin Rekap AM (M14 D-14/RM-9a) — pihak luar bisa merusak
-- angka performa orang tanpa autentikasi.
--
-- NOL perubahan untuk pemanggil sah: pg_cron jalan sebagai owner (postgres),
-- route internal memakai service-role. Berkas ini MENYEMPITKAN saja.

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
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman: kalau salah satu masih terbuka, GAGALKAN migrasinya alih-alih
-- melaporkan sukses palsu.
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
