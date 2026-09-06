-- ============================================================================
-- SCR-UI-1 — divisi Ads boleh me-LIST klien, DIBATASI ke klien yang punya
--            brief Ads.
--
-- Keputusan pemilik, dua tahap:
--   * 2026-09-05 — arah: "Ads boleh me-LIST klien" ⇒ YA.
--   * 2026-09-06 — scope: hanya klien ber-layanan Ads, dan ketika ditanya apa
--     yang MENANDAI sebuah layanan sebagai "layanan Ads", jawabannya
--     **"ada brief Ads"**. Ditanya juga apakah klien yang layanan Ads-nya sudah
--     selesai tetap boleh dibaca: **"tetap bisa dibaca historynya"**.
--
-- Kedua jawaban itu yang membentuk predikat di bawah, dan keduanya
-- MENYEDERHANAKANNYA dibanding rancangan awal:
--   * satu jejak (brief Ads), bukan gabungan dua jejak;
--   * nol filter status layanan.
--
-- KENAPA INI MIGRASI, BUKAN PERUBAHAN UI. `/ads/screening` dan `/ads/scanner`
-- meminta ID klien sebagai kolom teks justru KARENA gerbang baca klien hari ini
-- berbasis kepemilikan Account (AM), bukan Ads: seorang staff Ads yang mengetik
-- ID yang benar tetap tidak melihat baris klien itu. Picker klien tanpa arm RLS
-- ini akan jadi daftar kosong, bukan fitur.
--
-- ---------------------------------------------------------------------------
-- CATATAN UNTUK PEMBACA BERIKUTNYA — kenapa "brief Ads" dan bukan katalog.
--
-- Skema CDPS TIDAK punya satu pun field katalog yang menandai sebuah layanan
-- sebagai milik divisi Ads. Diperiksa 2026-09-06:
--   * `master_service_versions.category` berisi PLATFORM (Shopee/TikTok/…),
--     bukan divisi — dikonfirmasi terhadap `docs/handoff/MSL_DRAFT_KOMPILASI.csv`.
--   * `services` sendiri nol kolom divisi.
-- Jadi "berlayanan Ads" HARUS disimpulkan dari jejak. Ada dua kandidat, dan
-- pemilik memilih yang kedua:
--   (a) `service_plan_gate.divisi_terlibat` — CSV yang diisi AM di form G-B.
--   (b) `briefs.assigned_division` — pekerjaan yang benar-benar didispatch ke Ads.
--
-- (b) yang dipakai. Konsekuensinya diketahui dan diterima: klien yang layanan
-- Ads-nya sudah ditutup di form G-B tapi **belum pernah punya brief Ads** tidak
-- muncul di daftar. Itu tidak memblokir pekerjaan — jalur MENJALANKAN scan
-- (`POST /clients/{id}/adsscanner/scan`) dan tab Portofolio memakai `db()`
-- service-role dengan predikat TS, BUKAN `readAsActor`, jadi keduanya tidak
-- pernah lewat `clients_select` sama sekali. Tautan `/ads/scanner?client=…`
-- karenanya tetap berfungsi penuh untuk klien di luar daftar.
--
-- Kalau scope-nya perlu diubah lagi, yang disunting HANYA badan fungsi
-- `private.jwt_client_has_ads_brief` di bawah — policy-nya tidak ikut
-- disentuh. Itu sebabnya predikatnya diisolasi jadi satu fungsi.
-- ---------------------------------------------------------------------------
--
-- NOL FILTER STATUS, dan itu disengaja. Rancangan awal menyaring layanan yang
-- sudah mencapai state terminal mesin `service` (`Done`,
-- `[Cancelled — Service Voided]`). Pemilik membatalkannya 2026-09-06: riwayat
-- harus tetap terbaca. Praktisnya itu berarti klien yang sudah selesai TETAP
-- muncul, sehingga tim Ads bisa membuka scan periode lalu — yang memang inti
-- kata "history" di jawaban pemilik.
--
-- Sifat: MEMPERLUAS SELECT saja (menambah satu arm, seluruh arm lama
-- dipertahankan VERBATIM dari 20260901010000). Policy tulis tidak disentuh
-- (default-deny; tulis lewat RPC). Nol tabel baru, nol prefix, nol mesin state,
-- nol notif event.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Predikat "klien ini punya brief Ads".
--
--    SECURITY DEFINER dengan alasan yang sama persis dengan
--    `private.jwt_owns_client` (20260723064438 §9): subqueri di dalamnya
--    membaca `briefs`/`services`, dan tanpa DEFINER ia akan ikut ter-filter RLS
--    tabel-tabel itu — menghasilkan under-expose berganda dan risiko
--    saling-rekursi. `search_path` dikunci.
--
--    Ditaruh di skema `private`, bukan `public`, mengikuti relokasi
--    20260727072443: skema itu tidak diekspos PostgREST, jadi tidak ada jalur
--    `/rest/v1/rpc/` untuk fungsi ini. Itu juga sebabnya ia TIDAK perlu
--    didaftarkan ke allow-list §44 `rls_checks.sql` — pemindai di sana hanya
--    menyapu `public`, sama seperti `jwt_owns_client` yang juga tidak ada di
--    sana sejak dipindahkan.
--
--    `briefs` → klien lewat `services`: itu satu-satunya jalur yang ada
--    (`briefs.service_id` → `services.id` → `services.client_id`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.jwt_client_has_ads_brief(p_client_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.briefs b
      JOIN public.services s ON s.id = b.service_id
     WHERE s.client_id = p_client_id
       AND b.assigned_division = 'Ads'
  )
$$;

-- `authenticated` WAJIB bisa mengeksekusinya — ia dipanggil dari dalam ekspresi
-- policy `TO authenticated`, jadi mencabutnya membuat SETIAP baca `clients`
-- gagal, bukan cuma baca Ads. `anon` tidak boleh, dan `REVOKE ... FROM PUBLIC`
-- TIDAK cukup di Supabase (default privileges memberi EXECUTE per-role) —
-- sebut rolenya, idiom yang sama dengan 20260911070000/20260911080000.
REVOKE EXECUTE ON FUNCTION private.jwt_client_has_ads_brief(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.jwt_client_has_ads_brief(text) TO authenticated, service_role;

COMMENT ON FUNCTION private.jwt_client_has_ads_brief(text) IS
  'SCR-UI-1 — klien ini punya brief yang didispatch ke divisi Ads? Dipakai arm Ads '
  'di clients_select. Keputusan pemilik 2026-09-06: penanda "layanan Ads" adalah '
  'ADANYA BRIEF ADS (skema CDPS nol field katalog divisi), dan riwayat tetap terbaca '
  'sehingga TIDAK ada filter status layanan. Melebarkan/menyempitkan scope Ads = ubah '
  'badan fungsi INI saja.';

-- ---------------------------------------------------------------------------
-- 2. clients_select — arm Ads, di atas definisi TERAKHIR (20260901010000/S-01).
--
--    Seluruh arm lama disalin VERBATIM. Arm Ads sengaja BERSYARAT GANDA
--    (`jwt_division() = 'Ads'` DAN punya brief Ads): tanpa syarat pertama,
--    predikat itu ikut dievaluasi untuk setiap pembaca lain; tanpa syarat
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
       OR (jwt_division() = 'Ads' AND private.jwt_client_has_ads_brief(clients.id)));

COMMENT ON POLICY clients_select ON public.clients IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca klien seluruh divisinya, sejajar arm Account. '
  'SCR-UI-1 (2026-09-06): divisi Ads membaca klien yang punya brief Ads — bukan seluruh klien, '
  'dan tanpa filter status supaya riwayat tetap terbaca; predikatnya private.jwt_client_has_ads_brief.';
