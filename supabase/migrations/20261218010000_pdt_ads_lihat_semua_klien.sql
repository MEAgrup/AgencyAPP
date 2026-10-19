-- ============================================================================
-- PDT-ADS-SEMUA-KLIEN — divisi Ads membaca SELURUH klien (dan tokonya), dan
--                       `client_platforms_select` dibuat cermin penuh
--                       `clients_select`.
--
-- Keputusan pemilik 2026-10-19 (Yohan), atas feedback trial tim Ads "Laporan
-- PDT" butir 1 & 6. Dua gejala, dua akar:
--
-- (1) Butir 1 — "nama klien di halaman Upload PDT beda antara Head/AM/Ads; Ads
--     hanya melihat jasa TikTok, Shopee tidak". Klien Linda Hijab tercatat DUA
--     kali: CLI-202608-0010 "lindahijab.id" (punya brief Ads, toko Shopee-nya
--     nonaktif) dan CLI-202609-0038 "Linda Hijab" (toko Shopee AKTIF, nol brief
--     Ads). Arm Ads lama (`private.jwt_client_has_ads_brief`, SCR-UI-1) hanya
--     membuka klien PERTAMA, jadi Ads tidak pernah bisa memilih toko Shopee yang
--     benar. Pemilik memilih: divisi Ads melihat daftar klien yang SAMA dengan
--     Lead Account — seluruh klien. Ini MEMBALIK penolakan "Ads melihat seluruh
--     klien" pada SCR-UI-1 (2026-09-06); dicatat `docs/DECISIONS.md` 2026-10-19.
--
-- (2) Butir 6 — "pilihan platform/toko di CDPS Head tidak bisa diklik". Head
--     Account (lead) melihat klien lewat arm `jwt_is_lead() AND division =
--     'Account'` di `clients_select`, tetapi `client_platforms_select` TIDAK
--     punya arm itu (begitu pula arm Lead Sales dan Finance). Picker toko di
--     /account/pdt/upload dan /account/pdt/laporan membaca tabel ini di bawah
--     RLS, jadi daftar tokonya kosong dan halaman berkata "Klien ini belum
--     punya toko Shopee/TikTok Shop aktif" — padahal tokonya ada.
--
-- PERBAIKAN. `client_platforms_select` kini memuat SETIAP arm `clients_select`
-- (plus arm `created_by` miliknya sendiri), sehingga invariannya: toko sebuah
-- klien terlihat ⇔ kliennya terlihat. Arm-nya ditulis eksplisit (bukan
-- `EXISTS (SELECT … FROM clients)`) supaya tetap terbaca detektor ledger O48
-- di `supabase/tests/rls_checks.sql`, dan invariannya diuji langsung di §45.
--
-- `private.jwt_client_has_ads_brief` tidak lagi dipakai policy mana pun dan
-- tidak lagi dipakai domain (`pdt.ts` dulu memakainya untuk gerbang PDT) —
-- dihapus supaya tidak ada "knob scope Ads" kedua yang tampak hidup tapi mati.
--
-- Sifat: MEMPERLUAS SELECT saja. Policy tulis tidak disentuh (default-deny;
-- tulis lewat domain). Nol tabel baru, nol prefix, nol mesin state, nol event.
-- ============================================================================

DROP POLICY IF EXISTS clients_select ON public.clients;
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = sales_pic_id
       OR jwt_employee_id() = assigned_am_id
       OR jwt_employee_id() = commission_payment_pic_id
       OR jwt_employee_id() = created_by
       OR jwt_division() = 'Finance'
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR jwt_division() = 'Ads');

COMMENT ON POLICY clients_select ON public.clients IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca klien seluruh divisinya, sejajar arm Account. '
  'PDT-ADS-SEMUA-KLIEN (2026-10-19): divisi Ads (staff maupun lead) membaca seluruh klien — '
  'daftar klien Ads sama dengan Lead Account. Menggantikan arm brief-Ads SCR-UI-1. '
  'client_platforms_select WAJIB memuat arm yang sama.';

DROP POLICY IF EXISTS client_platforms_select ON public.client_platforms;
CREATE POLICY client_platforms_select ON public.client_platforms FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR jwt_division() = 'Finance'
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR jwt_division() = 'Ads');

COMMENT ON POLICY client_platforms_select ON public.client_platforms IS
  'PDT-ADS-SEMUA-KLIEN (2026-10-19): cermin penuh clients_select (toko terlihat <=> kliennya '
  'terlihat) plus arm created_by. Sebelumnya arm Lead Account/Lead Sales/Finance hilang, sehingga '
  'picker toko PDT kosong bagi Head Account.';

DROP FUNCTION IF EXISTS private.jwt_client_has_ads_brief(text);
