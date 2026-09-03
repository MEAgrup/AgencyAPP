-- ===========================================================================
-- Tambal permukaan EXECUTE check_complaint_rate_limit
-- ===========================================================================
--
-- TEMUAN (advisor Supabase, setelah 20260908010000 dipush ke CDPS SG):
--
--     Function `public.check_complaint_rate_limit(...)` can be executed by the
--     `anon` role as a `SECURITY DEFINER` function via
--     `/rest/v1/rpc/check_complaint_rate_limit`.
--
-- SEBABNYA. 20260908010000 §5 menutup pintu dengan
-- `REVOKE ALL ON FUNCTION ... FROM anon` lalu `... FROM authenticated`. Itu
-- tidak cukup: Postgres memberi EXECUTE ke **PUBLIC** untuk setiap fungsi baru,
-- dan `anon`/`authenticated` mewarisi lewat PUBLIC — jadi mencabut hak yang
-- tidak pernah diberikan secara langsung tidak mencabut apa pun. Saudara
-- kandungnya sudah benar sejak awal (20260906010000 baris 69–70) dan pola itu
-- yang dipakai di sini; punya saya menyimpang, bukan preseden yang berubah.
--
-- MENGAPA INI PENTING, bukan sekadar rapi. Fungsi ini MENULIS
-- (`INSERT INTO complaint_rate_limit_attempts`) dan ambangnya per-kontak. Siapa
-- pun tanpa login bisa memanggilnya berulang dengan uuid kontak seorang klien
-- sampai hitungannya mencapai 5, lalu kontak itu TIDAK BISA mengajukan komplain
-- selama satu jam — penolakan layanan pada satu-satunya pintu komplain mandiri
-- yang baru dibuka M15 Rule 5. Uuid kontak bukan rahasia yang bisa diandalkan
-- (ia muncul di klaim JWT portal), jadi "susah diduga" bukan mitigasi.
--
-- Nol perubahan perilaku untuk pemanggil yang sah: domain memanggilnya lewat
-- service-role, yang di-GRANT eksplisit di bawah.
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION
    public.check_complaint_rate_limit(uuid, inet, integer, integer, integer)
    FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.check_complaint_rate_limit(uuid, inet, integer, integer, integer)
    TO service_role;
