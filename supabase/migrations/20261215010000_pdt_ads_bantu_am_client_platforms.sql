-- ============================================================================
-- PDT-ADS-BANTU-AM — divisi Ads membaca `client_platforms` klien yang punya
--                    brief Ads, supaya bisa membantu AM mengunggah data toko
--                    (PDT) dan menyunting laporan PDT.
--
-- Keputusan pemilik 2026-10-01 (Yohan): "buat supaya akun team ads bisa
-- melakukan upload pdt dan edit laporan pdt, jadi ads bisa membantu AM".
--
-- KENAPA MIGRASI INI DIPERLUKAN. Gerbang tulis PDT ada di domain
-- (`pdt.canUploadBatch`/`canKirimLaporan`, dijalankan lewat `db()`), dan sudah
-- dilebarkan ke divisi Ads untuk klien ber-brief Ads. Tapi kedua halaman PDT
-- memilih toko lewat `GET /clients/{id}` → `readAsActor` → `sales.getClient`,
-- yang membaca `client_platforms` DI BAWAH RLS. Policy baseline tabel itu
-- (20260723064438) hanya punya arm kepemilikan per-orang, jadi staff Ads
-- melihat klien di picker (arm Ads `clients_select`, SCR-UI-1) tetapi daftar
-- tokonya KOSONG — halaman lalu berkata "Klien ini belum punya toko Shopee/
-- TikTok Shop aktif", gejala yang terlihat seperti data hilang, bukan RLS.
--
-- Predikatnya SENGAJA sama persis dengan arm Ads di `clients_select`
-- (`private.jwt_client_has_ads_brief`, SCR-UI-1): himpunan klien yang boleh
-- dilihat Ads tetap SATU definisi. Yang dibuka hanya baris toko dari klien yang
-- memang sudah terlihat oleh Ads — nol klien baru masuk jangkauan.
--
-- Sifat: MEMPERLUAS SELECT saja. Ketiga arm lama disalin dari baseline
-- (20260723064438), dengan `jwt_owns_client` memakai nama skema `private.`
-- pasca relokasi 20260727072443 — sama seperti 20261001010000. Policy tulis
-- tidak disentuh (default-deny; tulis lewat domain).
-- Nol tabel baru, nol prefix, nol mesin state, nol notif event.
--
-- Konsekuensi di `supabase/tests/rls_checks.sql` §O48: `client_platforms_select`
-- kini punya arm divisi, jadi ia KELUAR dari ledger "tanpa arm lead/divisi"
-- (ledger menyusut — arah yang benar), di commit yang sama.
-- ============================================================================

DROP POLICY IF EXISTS client_platforms_select ON public.client_platforms;
CREATE POLICY client_platforms_select ON public.client_platforms FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_division() = 'Ads' AND private.jwt_client_has_ads_brief(client_id)));

COMMENT ON POLICY client_platforms_select ON public.client_platforms IS
  'PDT-ADS-BANTU-AM (2026-10-01): divisi Ads membaca toko klien yang punya brief Ads — '
  'predikat sama dengan arm Ads clients_select (SCR-UI-1), supaya picker toko di '
  '/account/pdt/upload dan /account/pdt/laporan tidak kosong bagi tim Ads.';
