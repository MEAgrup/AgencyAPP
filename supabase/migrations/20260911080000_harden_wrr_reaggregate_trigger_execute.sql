-- CDPS — melengkapi `20260819010000_harden_secdef_execute_from_anon.sql` untuk
-- `authenticated` pada fungsi TRIGGER `wrr_reaggregate_on_close()`.
--
-- Ditemukan 2026-09-04 saat menyiapkan gerbang `rls_checks` §44 (penyelamatan
-- PR #171, O72): dijalankan terhadap live, arah kedua §44 gagal dengan
--   "SECURITY DEFINER dapat dieksekusi authenticated di luar daftar helper
--    policy: working_days_between, wrr_reaggregate_on_close"
-- Dua nama, dua nasib berbeda — dan itu justru inti kenapa gerbang ini ditulis
-- dengan allow-list, bukan larangan menyeluruh:
--
--   * `working_days_between(date,date)` → **SENGAJA terbuka**, didaftarkan ke
--     allow-list §44. Ia SECURITY DEFINER JUSTRU supaya pemanggil ber-RLS bisa
--     menghitung hari kerja tanpa diberi akses ke `hari_libur`
--     (`20260907020000`), dan ia hanya mengembalikan integer — tidak pernah
--     satu baris pun kalender. Mencabutnya = mematikan
--     `GET /briefs/{id}/stage` dan timeline Kelola Klien, persis regresi yang
--     migrasi itu perbaiki.
--
--   * `wrr_reaggregate_on_close()` → **dikunci di sini.** `RETURNS trigger`,
--     dipasang HANYA lewat `CREATE TRIGGER trg_wrr_reaggregate_on_close ON
--     weekly_result_recap` (`20260818010000`), NOL call site TypeScript.
--
-- Kenapa pencabutan ini aman — aturan yang REPO INI sudah tetapkan sendiri di
-- `20260819010000` baris 24-26: "fungsi trigger (RETURNS trigger) → HANYA
-- service_role. Trigger menyala tanpa cek EXECUTE (definer rights), dan
-- RETURNS trigger tak bisa dipanggil langsung, jadi tak ada role yang butuh
-- EXECUTE-nya." Postgres memeriksa EXECUTE saat `CREATE TRIGGER`, bukan saat
-- trigger menyala.
--
-- Migrasi itu memang MENIATKAN nasib ini untuk fungsi trigger, tapi selektornya
-- hanya menyapu fungsi yang masih bisa dieksekusi `anon` — jadi begitu `anon`
-- tercabut, `authenticated` tertinggal terbuka. Berkas ini menutup sisa itu.
-- Menyempitkan saja, nol GRANT baru.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.wrr_reaggregate_on_close()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated', fn);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman: gagalkan, jangan lapor sukses palsu (pola 20260814130000).
DO $$
DECLARE
  bocor text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO bocor
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('wrr_reaggregate_on_close')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bocor IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTE masih terbuka untuk anon/authenticated pada: %', bocor;
  END IF;
END $$;
