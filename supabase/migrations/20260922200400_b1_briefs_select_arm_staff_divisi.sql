-- ============================================================================
-- B-1/B-4 — `briefs_select` mendapat arm **staff divisi pelaksana**.
--
-- ⚠️ INI PERBAIKAN REGRESI YANG SUDAH HIDUP DI `main`, bukan fitur baru.
--
-- ---------------------------------------------------------------------------
-- APA YANG RUSAK, DAN SEJAK KAPAN
--
-- Bunyi policy sebelum migrasi ini:
--
--     jwt_can_read_all()
--     OR jwt_employee_id() IN (assigned_pic, created_by)
--     OR (jwt_is_lead() AND assigned_division = jwt_division())
--     OR private.jwt_is_am_of_service(service_id)
--     OR (jwt_is_lead() AND jwt_division() = 'Account')
--
-- Seorang **staff divisi** hanya melihat Brief kalau ia `assigned_pic`-nya atau
-- pembuatnya. Sampai A-5, itu masih menutupi dirinya sendiri: AM mengisi
-- `assigned_pic`, jadi setidaknya PIC utama bisa membuka Brief-nya.
--
-- **A-5 (`8dabef67`, sudah di `main` lewat PR #310) menutup pintu itu**: AM
-- sekarang memilih DIVISI saja (ketokan K-1), server MENOLAK `assigned_pic` saat
-- pembuatan Brief, dan handoff Jalur A menyatakannya eksplisit — "Brief kini sah
-- lahir tanpa PIC, dan itu keadaan normal sekarang". Konsekuensinya: kolom yang
-- menjadi satu-satunya jalan baca staff divisi kini **kosong secara desain**.
--
-- Diukur terhadap `main` sesudah A-5, dengan Brief yang lahir tanpa PIC dan satu
-- Aset ber-PIC (`SET LOCAL ROLE authenticated` + klaim sungguhan):
--
--     staff Creative (PIC aset itu) ..... brief=0  aset=1   ← PUTUS
--     lead Creative ..................... brief=1  aset=1
--     AM pemilik ........................ brief=1  aset=1
--
-- `creative.assetSelect` masih `join briefs` demi `b.assigned_division` (O52
-- memindahkan `assigned_am_id` ke `private.brief_owner_am` tapi meninggalkan
-- join itu), jadi keterlihatan Aset MENUMPANG keterlihatan Brief:
-- `GET /assets/{id}` menjawab **404** kepada PIC-nya sendiri. `kol.ts:233` sama.
-- Antrean divisi ikut kosong untuk staff.
--
-- Ini sudah diperingatkan sebagai "BLOKER A-5" di
-- `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md` sebelum A-5 mendarat; A-5
-- mendarat tanpa arm-nya, jadi perbaikannya menyusul di sini.
--
-- ---------------------------------------------------------------------------
-- KENAPA INI PENYERASIAN, BUKAN PELONGGARAN BARU
--
-- Predikat TS yang menggerbangi baca Brief — `account.canSeeBrief` — SUDAH
-- mengizinkan staff divisi pelaksana:
--
--     actor.role.division === division &&
--       (level === LevelStaff || level === LevelLead)
--
-- Jadi DB hari ini LEBIH KETAT daripada aturan yang ditulis di TS untuk baca
-- yang sama. Itu kombinasi terburuk: predikatnya meloloskan, RLS mengosongkan
-- barisnya, dan halaman menjawab **404 — bukan 403**, sehingga terbaca sebagai
-- "belum ada datanya", bukan sebagai masalah izin. Migrasi ini membuat DB
-- mengatakan hal yang sama dengan TS. Tidak ada peran yang mendapat akses yang
-- `canSeeBrief` belum memberikannya.
--
-- Bentuknya digerbang **DIVISI**, bukan level: staff sudah punya jalur
-- `assigned_pic`/`created_by`, dan yang hilang justru "anggota divisi
-- pelaksana". Preseden bentuk + alasannya:
-- `20260807160000_o48_grup_b_assets_lead_arm.sql` (arm lead pada `assets_select`,
-- keputusan pemilik 2026-08-07 opsi (b): perbaiki PER TABEL sesuai kebutuhan
-- halaman).
--
-- `jwt_employee_id() <> ''` WAJIB ikut: sebuah token yang divisinya terisi tapi
-- tidak resolve ke karyawan mana pun bukan aktor CDPS
-- (`permission.actorFromClaims` melemparkan untuk `employee_id` kosong), dan
-- tanpa syarat itu klaim seperti itu akan membuka seluruh Brief divisi tersebut.
--
-- ⛔ BUKAN dengan melebarkan `services_select` / `clients_select` — itu opsi (a)
--    yang sudah DITOLAK pemilik 2026-08-07 (O52). Arm ini ada pada
--    `briefs_select` sendiri, atas kolom yang sudah ada di baris yang sedang
--    dievaluasi (`assigned_division`), jadi nol join dan nol referensi-diri.
--
-- ---------------------------------------------------------------------------
-- YANG **TIDAK** BERUBAH
--   * Nol arm TULIS. Ini `FOR SELECT`; `briefs_insert/update` tidak disentuh,
--     dan status Brief tetap eksklusif lewat `sm_transition`.
--   * Arm lead, arm AM pemilik, dan arm Account lead utuh — di-assert ulang di
--     `packages/domain/src/brief-scope.rls.test.ts`, karena migrasi ini menulis
--     ULANG seluruh policy dan arm yang hilang tanpa jejak adalah cara paling
--     rapi menghidupkan lagi cacat yang ia jaga.
--   * Ledger invariant `rls_checks.sql` §42 mendaftar policy yang **tanpa** arm
--     lead/divisi. `briefs_select` sudah punya arm lead sejak awal, jadi ia tidak
--     ada di daftar itu dan migrasi ini tidak menggesernya.
--   * `rls_checks.sql` check ~944 ("Creative lead must read own-division brief")
--     tetap benar. Tidak ada check yang bertumpu pada premis "staff TIDAK bisa
--     melihat brief" — diperiksa, bukan diasumsikan.
--   * Nol tabel / prefix / mesin / event baru ⇒ gerbang 146 / 40 / 31 / 73 TETAP.
-- ============================================================================

DROP POLICY IF EXISTS briefs_select ON public.briefs;
CREATE POLICY briefs_select ON public.briefs FOR SELECT TO authenticated
USING (
  public.jwt_can_read_all()
  OR public.jwt_employee_id() = (assigned_pic)::text
  OR public.jwt_employee_id() = (created_by)::text
  -- Lead/SPV divisi pelaksana — division-wide (Phase 0 §4 Role Matrix). UTUH.
  OR (public.jwt_is_lead() AND (assigned_division)::text = public.jwt_division())
  -- AM pemilik layanan. UTUH.
  OR private.jwt_is_am_of_service((service_id)::text)
  -- Account lead — memantau dispatch (keputusan Nerissa 2026-07-12). UTUH.
  OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
  -- B-1/B-4 BARU: STAFF divisi pelaksana. Cermin `account.canSeeBrief`, yang
  -- sudah mengizinkannya sejak awal. Wajib sejak A-5 membuat Brief lahir tanpa
  -- `assigned_pic` — tanpa arm ini, seorang PIC Aset tidak bisa membuka Brief
  -- induk pekerjaannya sendiri, dan `GET /assets/{id}` menjawab 404 kepadanya.
  OR ((assigned_division)::text = public.jwt_division() AND public.jwt_employee_id() <> '')
);

COMMENT ON POLICY briefs_select ON public.briefs IS
  'B-1/B-4 (2026-09-07): + arm STAFF divisi pelaksana, cermin account.canSeeBrief '
  'yang sudah mengizinkannya. Wajib sejak A-5 (K-1) membuat Brief lahir tanpa '
  'assigned_pic: kolom itu satu-satunya jalan baca staff, jadi tanpa arm ini PIC '
  'Aset tidak bisa membuka Brief induknya dan GET /assets/{id} 404 (assetSelect '
  'masih join briefs). Arm lead / AM pemilik / Account lead tidak berubah. '
  'Nol arm TULIS.';
