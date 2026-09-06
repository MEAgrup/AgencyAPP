-- ============================================================================
-- SCR-UI-1 — divisi Ads boleh me-LIST klien, DIBATASI ke klien yang punya
--            layanan Ads aktif.
--
-- Keputusan pemilik: arah "Ads boleh me-LIST klien" dijawab YA 2026-09-05
-- (DECISIONS "SCR-UI-1 DIJAWAB"), dan SCOPE-nya dijawab 2026-09-06:
-- **hanya klien ber-layanan Ads**, bukan seluruh klien.
--
-- KENAPA INI MIGRASI, BUKAN PERUBAHAN UI. `/ads/screening` dan `/ads/scanner`
-- meminta ID klien sebagai kolom teks justru KARENA gerbang baca klien hari ini
-- berbasis kepemilikan Account (AM), bukan Ads: seorang staff Ads yang mengetik
-- ID yang benar tetap tidak melihat baris klien itu. Picker klien tanpa arm RLS
-- ini akan jadi daftar kosong, bukan fitur.
--
-- ---------------------------------------------------------------------------
-- ⚠️ INTERPRETASI YANG DIPILIH — dicatat, BUKAN diputuskan diam-diam.
--     Lihat docs/DECISIONS.md 2026-09-06 (SCR-UI-1), butir 🔶.
--
-- Skema CDPS TIDAK punya satu pun field katalog yang menandai sebuah layanan
-- sebagai "milik divisi Ads". Diperiksa 2026-09-06:
--   * `master_service_versions.category` berisi PLATFORM (Shopee/TikTok/…),
--     bukan divisi — dikonfirmasi terhadap `docs/handoff/MSL_DRAFT_KOMPILASI.csv`.
--   * `services` sendiri nol kolom divisi.
-- Jadi "berlayanan Ads" harus disimpulkan dari jejak, dan hanya ada DUA jejak:
--
--   (a) `service_plan_gate.divisi_terlibat` — CSV nama divisi yang DIISI AM di
--       form G-B. Lengkap untuk layanan ber-tier `ditentukan_am`, tapi layanan
--       `plan_wajib` tidak pernah melewati form itu sehingga NOL barisnya.
--   (b) `briefs.assigned_division` — bukti terkuat bahwa Ads benar-benar
--       mengerjakan klien itu, tapi baru ada SETELAH brief pertama dibuat.
--
-- Keduanya sendirian tidak lengkap, dan arah kesalahannya berbeda: (a) sendiri
-- menyembunyikan klien plan-wajib, (b) sendiri menyembunyikan klien yang justru
-- BARU dan paling butuh picker-nya (brief pertamanya belum ada). Dipakai
-- GABUNGAN (a) ATAU (b): setiap klien yang lolos punya bukti keterlibatan Ads
-- yang ditulis manusia — seorang AM menyebut Ads di form G-B, atau ada brief
-- Ads. Gabungan ini tetap JAUH lebih sempit daripada "seluruh klien" yang
-- pemilik tolak.
--
-- Kalau pemilik ingin lebih sempit/lebar, yang perlu diubah HANYA badan fungsi
-- `private.jwt_client_has_ads_service` di bawah — policy-nya tidak ikut
-- disentuh. Itu sebabnya predikatnya diisolasi jadi satu fungsi, bukan ditulis
-- inline di policy.
-- ---------------------------------------------------------------------------
--
-- "AKTIF" = status layanan BUKAN state terminal mesin `service`
-- (`Done`, `[Cancelled — Service Voided]`). Dibaca dari `sm_terminal_states`,
-- bukan dari dua string yang diketik ulang di sini: mesin statusnya bisa
-- bertambah state terminal, dan definisi "aktif" harus ikut tanpa ada yang
-- perlu ingat menyunting berkas ini.
--
-- Konsekuensi yang DISENGAJA dan perlu diketahui: klien yang seluruh layanan
-- Ads-nya sudah `Done` KELUAR dari daftar. Itu mengikuti kata "aktif" di
-- keputusan pemilik. Kalau tim Ads butuh membuka scan periode lalu untuk klien
-- yang layanannya sudah selesai, itu pelebaran yang butuh ketokan tersendiri —
-- 🔶 di DECISIONS.
--
-- Sifat: MEMPERLUAS SELECT saja (menambah satu arm, seluruh arm lama
-- dipertahankan VERBATIM dari 20260901010000). Policy tulis tidak disentuh
-- (default-deny; tulis lewat RPC). Nol tabel baru, nol prefix, nol mesin state,
-- nol notif event.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Predikat "klien ini punya layanan Ads aktif".
--
--    SECURITY DEFINER dengan alasan yang sama persis dengan
--    `private.jwt_owns_client` (20260723064438 §9): subqueri di dalamnya
--    membaca `services`/`briefs`/`service_plan_gate`, dan tanpa DEFINER ia akan
--    ikut ter-filter RLS tabel-tabel itu — menghasilkan under-expose berganda
--    dan risiko saling-rekursi. `search_path` dikunci.
--
--    Ditaruh di skema `private`, bukan `public`, mengikuti relokasi
--    20260727072443: skema itu tidak diekspos PostgREST, jadi tidak ada jalur
--    `/rest/v1/rpc/` untuk fungsi ini. Itu juga sebabnya ia TIDAK perlu
--    didaftarkan ke allow-list §44 `rls_checks.sql` — pemindai di sana hanya
--    menyapu `public`, sama seperti `jwt_owns_client` yang juga tidak ada di
--    sana sejak dipindahkan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.jwt_client_has_ads_service(p_client_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    -- (a) Layanan AKTIF yang form G-B-nya menyebut divisi Ads.
    EXISTS (
      SELECT 1
        FROM public.services s
        JOIN public.service_plan_gate g ON g.service_id = s.id
       WHERE s.client_id = p_client_id
         AND s.status NOT IN (SELECT t.state FROM public.sm_terminal_states t
                               WHERE t.machine = 'service')
         -- `divisi_terlibat` adalah CSV yang disusun `attrs.divisiTerlibat.join(', ')`
         -- (plangate.ts). Spasi dibuang sebelum dipecah supaya 'Creative, Ads'
         -- dan 'Creative,Ads' dibaca sama.
         AND 'Ads' = ANY (string_to_array(replace(g.divisi_terlibat, ' ', ''), ','))
    )
    OR
    -- (b) Brief Ads pada salah satu layanan AKTIF klien ini.
    EXISTS (
      SELECT 1
        FROM public.briefs b
        JOIN public.services s2 ON s2.id = b.service_id
       WHERE s2.client_id = p_client_id
         AND s2.status NOT IN (SELECT t.state FROM public.sm_terminal_states t
                                WHERE t.machine = 'service')
         AND b.assigned_division = 'Ads'
    )
$$;

-- `authenticated` WAJIB bisa mengeksekusinya — ia dipanggil dari dalam ekspresi
-- policy `TO authenticated`, jadi mencabutnya membuat SETIAP baca `clients`
-- gagal, bukan cuma baca Ads. `anon` tidak boleh, dan `REVOKE ... FROM PUBLIC`
-- TIDAK cukup di Supabase (default privileges memberi EXECUTE per-role) —
-- sebut rolenya, idiom yang sama dengan 20260911070000/20260911080000.
REVOKE EXECUTE ON FUNCTION private.jwt_client_has_ads_service(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.jwt_client_has_ads_service(text) TO authenticated, service_role;

COMMENT ON FUNCTION private.jwt_client_has_ads_service(text) IS
  'SCR-UI-1 — klien ini punya layanan Ads AKTIF? Gabungan dua jejak: form G-B '
  '(service_plan_gate.divisi_terlibat memuat "Ads") ATAU brief ber-assigned_division '
  '"Ads". Skema CDPS nol field katalog "layanan ini milik Ads", jadi ini kesimpulan '
  'dari jejak, bukan pembacaan fakta — interpretasinya dicatat di DECISIONS 2026-09-06 '
  '(SCR-UI-1, butir 🔶). Melebarkan/menyempitkan scope Ads = ubah badan fungsi INI saja.';

-- ---------------------------------------------------------------------------
-- 2. clients_select — arm Ads, di atas definisi TERAKHIR (20260901010000/S-01).
--
--    Seluruh arm lama disalin VERBATIM. Arm Ads sengaja BERSYARAT GANDA
--    (`jwt_division() = 'Ads'` DAN punya layanan Ads): tanpa syarat pertama,
--    predikat mahal itu ikut dievaluasi untuk setiap pembaca lain; tanpa syarat
--    kedua, ini jadi "Ads melihat seluruh klien" yang justru pemilik tolak.
--
--    Sengaja TANPA `jwt_is_lead()`: keputusan pemilik berbunyi "divisi Ads",
--    dan alasannya ("memudahkan jalannya Ads dan pelaporan") berlaku untuk
--    staff Ads yang menjalankan scan, bukan cuma Head-nya. Pembatasnya di sini
--    adalah HIMPUNAN KLIEN, bukan level jabatan — beda dengan arm Sales/Account
--    yang membuka SELURUH klien sehingga memang harus dikunci ke lead.
-- ---------------------------------------------------------------------------
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
       OR (jwt_division() = 'Ads' AND private.jwt_client_has_ads_service(clients.id)));

COMMENT ON POLICY clients_select ON public.clients IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca klien seluruh divisinya, sejajar arm Account. '
  'SCR-UI-1 (2026-09-06): divisi Ads membaca klien yang punya layanan Ads AKTIF saja — '
  'bukan seluruh klien; predikatnya private.jwt_client_has_ads_service.';
