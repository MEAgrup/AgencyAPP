-- ============================================================================
-- QA live 2026-08-03 — `GET /attempts/{id}` 500 "internal server error".
--
-- GEJALA: buka `/sales/PRSP-202608-0001` sebagai Direktur ⇒ halaman hanya
-- menampilkan kotak merah "internal server error". Barisnya ADA, route-nya
-- benar; yang gagal adalah kueri TERAKHIR di `sales.getAttempt` — introspeksi
-- mesin yang menentukan tombol aksi mana yang ada:
--
--     select to_state from sm_edges where machine = … and from_state = …
--
-- Dijalankan lewat `readAsActor` (`SET LOCAL ROLE authenticated`) ⇒
--     ERROR 42501: permission denied for table sm_edges
-- Error Postgres itu tidak terpetakan di `apps/api` `mapError` ⇒ 500 opaque.
-- Direproduksi langsung di `CDPS SG` dengan klaim Direktur sebelum migrasi ini.
--
-- SEBABNYA DRIFT ANTAR DUA KEPUTUSAN YANG BENAR SENDIRI-SENDIRI:
--   * `20260723064438_rls_baseline.sql` §5 menaruh `sm_machines`/`sm_edges`/
--     `sm_terminal_states`/`notif_events` di grup "internal murni": RLS aktif,
--     TANPA policy, SELECT dicabut dari `authenticated`. Sah pada saat itu —
--     satu-satunya pembaca `sm_edges` adalah `sm_transition`, SECURITY DEFINER
--     milik `postgres` (BYPASSRLS). Invarian itu DIKODEKAN di
--     `supabase/tests/rls_checks.sql` §9.
--   * O37 kemudian memindahkan SELURUH jalur BACA dari koneksi privileged ke
--     `readAsActor`, supaya policy RLS benar-benar berlaku. Sejak itu
--     `engine.allowedTransitions` membaca `sm_edges` sebagai `authenticated` —
--     hak yang memang tidak pernah diberikan.
--   Keduanya tidak pernah dirujukkan satu sama lain. Halaman detail attempt
--   adalah SATU-SATUNYA jalur baca yang menabraknya: `allowedTransitions` hanya
--   dipanggil dari `sales.getAttempt`.
--
-- KEPUTUSAN (lihat `docs/DECISIONS.md` 2026-08-03): tabelnya TETAP tertutup;
-- yang dibuka hanya JAWABANNYA, lewat SECURITY DEFINER di schema `private`
-- (schema yang tidak diekspos PostgREST — pola `20260727072443`).
--
-- Mengapa bukan `GRANT SELECT ON sm_edges TO authenticated` (opsi yang ditolak):
--   1. Ia membatalkan invarian yang sudah dikodekan di `rls_checks.sql` §9.
--      Menyetel ulang tes supaya cocok dengan perubahan adalah cara paling rapi
--      untuk kehilangan invarian yang sengaja dipasang.
--   2. Arah dua migrasi hardening terakhir (advisor 0029, `20260727072443`)
--      adalah MENGECILKAN permukaan yang terekspos, bukan menambahnya. `public`
--      terekspos PostgREST; `private` tidak.
--   3. Fungsi ini mengembalikan JAUH lebih sedikit daripada tabelnya: hanya
--      daftar `to_state` untuk satu (machine, from_state) — persis yang sudah
--      dipublikasikan sebagai field `allowed_transitions` di respons API — dan
--      TIDAK membocorkan `require_lead` maupun seluruh graf mesin.
--
-- Yang TIDAK berubah: menulis status tetap eksklusif lewat `sm_transition`
-- (EXECUTE-nya dicabut dari `authenticated` oleh `20260723064826`), gate
-- `require_lead` tetap dievaluasi di sana, dan `sm_edges` tetap tanpa policy
-- apa pun — konfigurasi mesin hanya berubah lewat migrasi. `sm_machines`,
-- `sm_terminal_states`, `notif_events` sengaja tidak disentuh: nol jalur baca TS
-- yang menyentuhnya. Perbaikan ini seluas bug-nya, tidak lebih.
-- ============================================================================

-- Idempoten + mandiri: schema `private` sudah dibuat 20260727072443, tapi guard
-- ini membuat berkas aman di-apply ulang dan di-rebuild dari nol.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Introspeksi mesin: state yang bisa dicapai dalam SATU langkah dari
-- (p_machine, p_from_state). Mesin/state tak dikenal dan state terminal ⇒ array
-- KOSONG, bukan NULL — klien mengiterasi hasilnya untuk memutuskan tombol mana
-- yang dirender, dan NULL akan melempar alih-alih merender halaman tanpa aksi.
--
-- `collate "C"` load-bearing (bukan hiasan): status CDPS ada yang berkurung
-- (`[Closed - Kalah Kompetisi]`). Kolasi glibc semacam `en_US.utf8`
-- memprioritaskan tanda baca sehingga menaruhnya PERTAMA, sedangkan `C` — dan
-- Go `sort.Strings`, dan JS — menaruhnya TERAKHIR. Tanpa dipatok, urutan tombol
-- di respons API bergantung pada locale cluster. Sama dengan yang dipatok
-- `engine.allowedTransitions` sebelum migrasi ini; ORDER BY dipindah KE DALAM
-- `array_agg` supaya urutannya tetap milik fungsi ini, bukan milik pemanggil.
CREATE OR REPLACE FUNCTION private.sm_allowed_transitions(p_machine text, p_from_state text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT coalesce(array_agg(e.to_state ORDER BY e.to_state COLLATE "C"), '{}'::text[])
    FROM public.sm_edges e
   WHERE e.machine = p_machine AND e.from_state = p_from_state
$$;

-- Permukaan EXECUTE: `authenticated` WAJIB bisa (itulah jalur baca yang
-- diperbaiki), `service_role` untuk job batch. `public`/`anon` dicabut — belum
-- login tidak punya urusan dengan konfigurasi mesin.
REVOKE EXECUTE ON FUNCTION private.sm_allowed_transitions(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION private.sm_allowed_transitions(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION private.sm_allowed_transitions(text, text) TO authenticated, service_role;
