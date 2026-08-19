-- CDPS — Keamanan: kunci EXECUTE setiap fungsi SECURITY DEFINER dari `anon`.
--
-- KENAPA INI ADA (drift repo↔live, temuan triage PR #171, 2026-08-19).
-- Proyek Supabase memasang default-privileges yang menghibahkan EXECUTE ke
-- `anon`/`authenticated` untuk fungsi baru; DAN default Postgres menghibahkan
-- EXECUTE ke PUBLIC. Idiom `REVOKE EXECUTE ... FROM PUBLIC` saja (dipakai
-- beberapa migrasi) TIDAK cukup di Supabase (hibah per-role tetap), dan
-- `REVOKE ... FROM anon` saja TIDAK cukup di Postgres polos (hibah PUBLIC tetap).
-- Idiom yang benar — yang dipakai fungsi yang SUDAH aman (mis. `jwt_owns_client`
-- ber-ACL `{postgres,authenticated,service_role}`) — mencabut PUBLIC lalu
-- MENYEBUT role penerima yang sah secara eksplisit.
--
-- Live CDPS SG sudah menutup fungsi job (`wrr_*`, `penugasan_reminder_tick` =
-- `anon=false`) TAPI helper predikat RLS `private.jwt_*`/`*_owns_*` (+ dua di
-- `public`) dan trigger `wrr_reaggregate_on_close` masih ber-ACL PUBLIC di repo
-- MAUPUN live. Karena berkas hardening lama tak pernah masuk repo, setiap
-- `db-rebuild`, CI, dan DEPLOYMENT/ENVIRONMENT BARU dari repo memunculkan celah
-- itu. Migrasi ini menutup drift itu di repo, idempotent di live.
--
-- APA YANG DILAKUKAN (sapuan set-based; classify per kebutuhan, bukan signature
-- hardcode). Untuk SETIAP fungsi SECURITY DEFINER di `public`/`private` yang masih
-- bisa dieksekusi `anon`: cabut EXECUTE dari PUBLIC + anon, lalu hibahkan ulang
-- ke role sah:
--   * fungsi trigger (RETURNS trigger) → HANYA `service_role`. Trigger menyala
--     tanpa cek EXECUTE (definer rights), dan `RETURNS trigger` tak bisa dipanggil
--     langsung, jadi tak ada role yang butuh EXECUTE-nya.
--   * lainnya = helper predikat RLS → `authenticated` + `service_role`. Policy
--     RLS `TO authenticated` mengevaluasinya, jadi `authenticated` WAJIB tetap
--     punya EXECUTE (menghindari bahaya "sweep mematikan pembacaan" PR #171).
--
-- KENAPA AMAN (hanya menyempit + regrant eksplisit, nol pelebaran).
--  * `anon` TAK PERNAH perlu SECURITY DEFINER: penulisan lewat RPC service-role,
--    predikat RLS dievaluasi untuk `authenticated`, GoTrue hook dipanggil auth-admin.
--  * `authenticated` dipertahankan untuk helper predikat → RLS tak putus.
--  * Idempotent: di live, fungsi yang sudah aman terfilter keluar (anon=false);
--    yang tersisa berakhir pada ACL yang sama dengan fungsi yang sudah aman.
--    Di Postgres polos, hasil akhirnya menyamai posture live.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS func_name,
           pg_get_function_identity_arguments(p.oid) AS args,
           (p.prorettype = 'pg_catalog.trigger'::regtype) AS is_trigger
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef
       AND n.nspname IN ('public', 'private')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.schema_name, r.func_name, r.args);
    IF r.is_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
                     r.schema_name, r.func_name, r.args);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role',
                     r.schema_name, r.func_name, r.args);
    END IF;
  END LOOP;
END $$;

-- Sabuk pengaman: setelah sapuan, NOL fungsi SECURITY DEFINER boleh dieksekusi
-- `anon`. Kalau ada yang lolos, gagalkan migrasi alih-alih sukses palsu.
DO $$
DECLARE
  n_open int;
BEGIN
  SELECT count(*) INTO n_open
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE p.prosecdef
     AND ns.nspname IN ('public', 'private')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF n_open > 0 THEN
    RAISE EXCEPTION
      'harden_secdef_execute_from_anon: % fungsi SECURITY DEFINER masih EXECUTE-able oleh anon', n_open;
  END IF;
END $$;
