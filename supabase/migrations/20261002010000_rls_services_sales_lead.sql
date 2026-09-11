-- ===========================================================================
-- Laporan Penjualan: rekap layanan berhenti kosong untuk Head Sales
-- ===========================================================================
--
-- ── Apa yang ditambal, dan kenapa ia baru muncul sekarang ─────────────────
--
-- Migrasi `20261001010000` memberi Finance lengan baca pada tiga tabel uang
-- (`client_sales_allocations`, `contracts`, `services`) dan memberi Sales-lead
-- lengan pada DUA yang pertama saja. `services_select` sengaja dilewati waktu
-- itu, dengan alasan yang tercatat di tesnya sendiri: *"Head Sales butuh angka
-- UANG timnya (alokasi + kontrak); rekap layanan adalah permukaan laporan
-- Finance, dan melebarkan Sales-lead ke sana tidak diminta siapa pun."*
--
-- Alasan itu ternyata salah membaca permintaan pemiliknya. Permintaan verbatim
-- 2026-09-10 berbunyi: *"Laporan penjualan all sales, total GMV, **service
-- list**, bisa diakses **Finance & Head Sales**"* — satu laporan, satu daftar
-- pembacanya, dan `service list` ada DI DALAM laporan itu. Jadi Head Sales
-- memang diminta melihat rekap layanan; yang belum ada waktu itu bukan
-- keputusannya, melainkan layarnya.
--
-- Tanpa lengan ini, laporan Penjualan menjawab 200 untuk Head Sales dengan
-- bagian "Rekap Layanan" KOSONG — bukan galat, bukan penolakan, hanya daftar
-- kosong yang terbaca seperti "bulan ini tidak ada layanan terjual". Itu
-- bentuk kegagalan yang sama persis dengan bug `client_sales_allocations`
-- yang baru saja ditutup migrasi sebelumnya, di layar yang sama, dua minggu
-- kemudian. Karena itu ia ditutup sekarang, bersama layarnya, bukan nanti.
--
-- ── Kenapa ini bukan pelebaran hak yang berarti ───────────────────────────
--
-- Head Sales SUDAH melihat `contracts` dan `client_sales_allocations` untuk
-- seluruh agensi lewat migrasi sebelumnya — yaitu nilai kontrak dan siapa yang
-- menjualnya. `services` menambahkan RINCIAN baris dari nilai yang sama
-- (`master_service_id` + `standard_price` snapshot). Tidak ada kelas informasi
-- baru yang terbuka; yang bertambah adalah resolusinya.
--
-- Bentuk lengannya sengaja identik dengan lengan Sales-lead pada
-- `contracts_select` (`jwt_is_lead() AND jwt_division() = 'Sales'`): Sales
-- STAFF tetap tanpa lengan divisi, karena `salesperf.reportScopeFor` mengunci
-- mereka ke baris sendiri dan lengan `jwt_owns_client` yang sudah ada persis
-- melayani itu.
--
-- Gate berhitung TIDAK bergerak: nol tabel, nol kolom, nol prefix, nol mesin,
-- nol event.
-- ===========================================================================

DROP POLICY IF EXISTS services_select ON public.services;
CREATE POLICY services_select ON public.services FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR jwt_division() = 'Finance');

COMMENT ON POLICY services_select ON public.services IS
  'Baseline + lengan Account-lead + Finance (2026-09-10, rekap layanan pada '
  'laporan penjualan) + Sales-lead (2026-09-10, PR-3: pemilik meminta laporan '
  'yang SAMA — termasuk service list — bisa diakses Finance DAN Head Sales; '
  'tanpa lengan ini rekapnya kosong untuk Head Sales tanpa galat apa pun). '
  'Sales STAFF sengaja tanpa lengan: reportScopeFor mengunci mereka ke baris '
  'sendiri.';
