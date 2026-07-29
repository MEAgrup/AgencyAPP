-- ===========================================================================
-- BACK-PORT RIWAYAT VERSI — bukan perubahan skema baru.
-- ===========================================================================
-- Berkas ini ada supaya riwayat migrasi repo cocok 1:1 dengan
-- `supabase_migrations.schema_migrations` di `CDPS SG`. Migrasi ini pernah
-- di-apply LANGSUNG ke live (versi 20260723064826) tanpa padanan berkas di repo,
-- sehingga selama ini live punya 40 baris riwayat sementara repo punya 39 berkas
-- — selisih yang membuat `supabase db push` berpotensi dipersoalkan CLI.
--
-- Isinya di bawah adalah **statements live VERBATIM** (diambil dari
-- `schema_migrations.statements`), disiplin yang sama seperti O38 opsi (A):
-- repo mereproduksi produksi, bukan tafsirannya. Satu-satunya suntingan adalah
-- referensi versi di komentar aslinya (`20260102000003` → `20260723064438`),
-- konsisten dengan penyelarasan penomoran 2026-07-29 — nol DDL berubah.
--
-- MENGAPA ISINYA TERLIHAT DUPLIKAT. Statements ini sudah termuat di
-- `20260723064438_rls_baseline.sql` §9, dan O38 butir 3 karena itu memutuskan
-- TIDAK mem-back-port-nya. Keputusan itu dipersempit (bukan dibalik) pada
-- 2026-07-29: alasan O38 tetap berlaku untuk *isi* (memang beda pengemasan,
-- bukan beda isi), tetapi ia tidak menyelesaikan *penomoran*, yang O38 sendiri
-- catat sebagai di luar scope-nya. Lihat `docs/DECISIONS.md` 2026-07-29 dan
-- `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §A.7.
--
-- AMAN DIJALANKAN DUA KALI. Seluruh statements di bawah adalah REVOKE / GRANT /
-- ALTER FUNCTION ... SET search_path — semuanya menetapkan keadaan akhir, bukan
-- delta, jadi menerapkannya lagi setelah rls_baseline §9 tidak mengubah apa pun.
-- Diverifikasi: DB dibangun dari nol dengan 40 berkas menghasilkan ACL fungsi
-- dan `proconfig` yang identik dengan build 39 berkas, dan identik dengan live.
--
-- POSISI TIDAK BOLEH DIGESER. Versi 20260723064826 duduk SESUDAH
-- 20260723064438_rls_baseline (yang membuat `public.jwt_owns_*`) dan SEBELUM
-- 20260727072443_harden_secdef_helpers_to_private_schema (yang memindahkannya
-- ke schema `private`). Menomori ulang berkas ini ke posisi mana pun setelah
-- migrasi 20260727072443 akan membuatnya GAGAL — `public.jwt_owns_lead(text)`
-- sudah tidak ada di sana.
-- ===========================================================================

-- Fase 1 — hardening EXECUTE surface + retrofit search_path (advisor 0028/0029/0011).
-- Delta atas rls_baseline (di file repo digabung ke 20260723064438 §9).

-- House-engine functions: server-side only (executor service-role), bukan RPC publik.
REVOKE EXECUTE ON FUNCTION public.ident_next(text, timestamptz) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sm_transition(text, text, text, text, text, text, text, text, boolean, boolean) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, text, text, text, text, text, text[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ident_next(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_transition(text, text, text, text, text, text, text, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, text, text, text, text, text, text[], boolean) TO service_role;

-- Policy-helper SECURITY DEFINER: authenticated wajib EXECUTE (eval policy); anon dicabut.
REVOKE EXECUTE ON FUNCTION public.jwt_owns_client(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_transaction(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.jwt_owns_lead(text) FROM public;
GRANT EXECUTE ON FUNCTION public.jwt_owns_client(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jwt_owns_transaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jwt_owns_lead(text) TO authenticated;

-- Retrofit search_path fungsi fondasi lama (advisor 0011).
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.forbid_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.wib_date(timestamptz) SET search_path = public, pg_temp;
ALTER FUNCTION public.wib_period(timestamptz) SET search_path = public, pg_temp;
