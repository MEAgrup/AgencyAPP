-- ===========================================================================
-- Kinerja Sales: Head Sales berhenti melihat NOL, dan Finance mendapat
-- lengan bacanya
-- ===========================================================================
--
-- ── Bug yang ditutup, dan kenapa ia tidak pernah terlihat ─────────────────
--
-- Halaman Kinerja Sales (`/sales/kinerja`) menghitung kolom klien & uang dari
-- `client_sales_allocations`, dibaca lewat `readAsActor` — jadi tunduk RLS.
-- Sampai hari ini `client_sales_allocations_select` berbunyi:
--
--     jwt_can_read_all() OR created_by = jwt_employee_id()
--                        OR private.jwt_owns_client(client_id)
--
-- Ketiga lengan itu PER-ORANG. `jwt_owns_client` true hanya bila aktor adalah
-- `sales_pic_id` / `assigned_am_id` / `commission_payment_pic_id` / `created_by`
-- KLIEN ITU. Tidak ada satu pun lengan divisi.
--
-- Akibatnya: seorang **Head Sales membuka Kinerja Sales dan melihat kolom
-- klien serta omzet SELURUH TIM-nya berisi 0.00** — bukan galat, bukan halaman
-- kosong, hanya angka nol yang terlihat sah. Baris orangnya tetap muncul
-- (roster datang dari `private.employee_roster()`, yang SECURITY DEFINER), jadi
-- tabelnya tampak normal dan salah.
--
-- Kenapa ini bertahan lama: **Director dan OD lolos lewat `jwt_can_read_all()`**
-- dan selalu melihat angka yang benar. Satu-satunya peran yang melihat bug ini
-- adalah peran yang tidak pernah dipakai untuk memeriksa. Tes domain juga tidak
-- bisa menangkapnya — mereka memakai koneksi superuser, sehingga RLS tidak
-- pernah ikut dievaluasi.
--
-- Dibuktikan dengan probe, bukan dibaca dari policy: dengan satu klien milik
-- EMP-0001 (Sales staff) dan satu kontrak, `GET /sales/performance` menjawab
-- `klien_count 1.00` untuk Director dan `0.00` untuk Head Sales; menambahkan
-- lengan di bawah mengubah jawaban Head Sales jadi `1.00`.
--
-- ── Kenapa lengan Sales-lead, dan kenapa SELURUH divisi ───────────────────
--
-- Cermin `salesperf.scopeFor`, yang sejak awal berbunyi "Sales lead/SPV =
-- seluruh divisi". Gerbang domainnya sudah mengizinkan; policy-nya lah yang
-- membantahnya. Ini bukan pelonggaran baru — ini menyelaraskan DB dengan
-- keputusan yang sudah lama diambil dan sudah diuji di sisi TS.
--
-- Sales STAFF sengaja TIDAK diberi lengan: `scopeFor` mengunci mereka ke baris
-- sendiri (`ownOnly`), dan lengan `created_by`/`jwt_owns_client` yang sudah ada
-- persis melayani itu.
--
-- ── Kenapa Finance ikut, padahal layarnya belum ada ───────────────────────
--
-- Permintaan pemilik 2026-09-10: laporan penjualan *"bisa diakses Finance &
-- Head Sales"*. Lengan RLS-nya mendarat lebih dulu supaya PR laporannya bisa
-- murni kode — dan sampai gerbang domainnya dibuka, lengan ini tidak mengubah
-- apa pun yang bisa dilihat Finance lewat layar mana pun.
--
-- Yang DIBERIKAN ke Finance hanya tiga tabel UANG: `contracts`,
-- `client_sales_allocations`, `services`. **Bukan** `leads`,
-- `prospect_attempts`, `prospect_activities`, atau alasan NQ. Pemilik meminta
-- laporan PENJUALAN, bukan corong prospek — dan membuka corong itu adalah
-- pelebaran yang tidak diminta siapa pun. Konsekuensinya dinyatakan supaya
-- tidak dibaca sebagai kelalaian: laporan Finance nanti berisi uang + layanan,
-- tanpa kolom aktivitas.
--
-- Finance SEMUA LEVEL, bukan lead saja — sama seperti lengan Finance pada
-- `transactions_select`/`installments_select` (`20260729032805`), dan dengan
-- alasan yang sama: pekerjaan penagihan dikerjakan staf, dan policy yang hanya
-- mengenal lead membuat antreannya kosong bagi orang yang benar-benar
-- mengerjakannya.
--
-- Gate berhitung TIDAK bergerak: nol tabel, nol kolom, nol prefix, nol mesin,
-- nol event. Ledger O48 di `rls_checks.sql` MENYUSUT satu baris.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) client_sales_allocations — lengan Sales-lead (bug) + Finance (laporan)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS client_sales_allocations_select ON public.client_sales_allocations;
CREATE POLICY client_sales_allocations_select ON public.client_sales_allocations FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR jwt_division() = 'Finance');

COMMENT ON POLICY client_sales_allocations_select ON public.client_sales_allocations IS
  'Baseline (rls_baseline §5) + lengan Sales-lead dan Finance (2026-09-10). Lengan '
  'Sales-lead MEMPERBAIKI BUG: sebelumnya ketiga lengan baseline semuanya '
  'per-orang, sehingga Head Sales melihat kolom klien & omzet seluruh timnya '
  'berisi 0.00 di Kinerja Sales — tanpa galat. Cermin salesperf.scopeFor, yang '
  'sudah lama menyatakan "Sales lead/SPV = seluruh divisi". Sales STAFF sengaja '
  'tanpa lengan: scopeFor mengunci mereka ke baris sendiri.';

-- ---------------------------------------------------------------------------
-- 2) contracts — lengan Finance
-- ---------------------------------------------------------------------------
--
-- `jenis` kontrak (baru / perpanjangan / cross_sell) adalah sumber kolom
-- "Klien Baru / Perpanjangan / Cross-sell" di laporan, dan `created_at`-nya
-- yang menentukan sebuah deal jatuh di periode mana. Tanpa lengan ini, laporan
-- Finance akan memakai bentuk kegagalan yang SAMA dengan bug Head Sales di
-- atas: join yang mati diam-diam, bukan penolakan yang terbaca.
DROP POLICY IF EXISTS contracts_select ON public.contracts;
CREATE POLICY contracts_select ON public.contracts FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR jwt_division() = 'Finance');

COMMENT ON POLICY contracts_select ON public.contracts IS
  'Baseline + lengan Account-lead + Sales-lead (FS-5) + Finance (2026-09-10, '
  'laporan penjualan). Finance semua level, cermin lengan Finance pada '
  'transactions_select/installments_select.';

-- ---------------------------------------------------------------------------
-- 3) services — lengan Finance
-- ---------------------------------------------------------------------------
--
-- Untuk rekap "layanan mana yang terjual" di laporan penjualan. Baris `services`
-- membawa `master_service_id` + `standard_price` snapshot, jadi rekapnya bisa
-- disusun tanpa menyentuh katalog hidup.
DROP POLICY IF EXISTS services_select ON public.services;
CREATE POLICY services_select ON public.services FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR jwt_division() = 'Finance');

COMMENT ON POLICY services_select ON public.services IS
  'Baseline + lengan Account-lead + Finance (2026-09-10, rekap layanan pada '
  'laporan penjualan). Finance semua level, cermin transactions_select.';
