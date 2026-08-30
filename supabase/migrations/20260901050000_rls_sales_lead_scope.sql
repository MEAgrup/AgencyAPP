-- Kinerja Sales (M0 §7.1) — S-01: Head Sales kehilangan cakupan divisi di TIGA
-- tabel inti (blocker §2 RENCANA_KINERJA_SALES.md — rencana itu menyebut EMPAT
-- tabel termasuk `transactions`, tapi audit migrasi di bawah menunjukkan
-- `transactions_select` SUDAH diperbaiki oleh O46, lihat catatan §3).
--
-- GEJALANYA. Pola repo: tiap kali Lead sebuah divisi butuh baca se-divisi,
-- sebuah migrasi menambah arm `jwt_is_lead() AND jwt_division() = '<Divisi>'`.
-- Finance dapat arm ini di baseline; Account dua kali (`20260805030100`
-- `clients_select`, `20260805060000` service scope); `prospect_activities`
-- dapat arm Sales-nya di `20260806050000`, komentarnya verbatim: "Head Sales
-- membaca effort seluruh timnya, yang justru alasan fitur ini diminta." Tapi
-- SALES tidak pernah dapat arm setara untuk `prospect_attempts`, `clients`,
-- `installments` — jadi Head Sales yang membaca lewat `readAsActor` (RLS
-- aktif) hanya melihat baris MILIKNYA SENDIRI di ketiganya: dasbor hijau,
-- angka salah, tanpa error. Persis kelas cacat yang sudah dua kali menggigit
-- repo ini (`20260805060000`, lalu `20260806050000`), dan melanggar
-- CLAUDE.md #6 + PERMISSIONS.md §M0 yang sudah menjanjikan "Lead/SPV =
-- division-wide".
--
-- KENAPA SEKARANG. Kinerja Sales (dashboard closing rate / deal cycle / win
-- rate per M0 §7.1 dan §8) membaca ketiga tabel ini lewat `readAsActor` untuk
-- Head/SPV Sales — kalau RLS-nya tidak diperbaiki lebih dulu, dashboard-nya
-- diam-diam salah untuk siapa pun selain Director/OD.
--
-- PERBAIKAN SAJA, BUKAN PELEBARAN HAK. Ini mengubah apa yang Head Sales lihat
-- di `/sales` dan `/clients` yang sudah ada — ke arah yang CLAUDE.md #6 sudah
-- janjikan (Lead/SPV = division-wide). Dicatat di `docs/DECISIONS.md`.
--
-- 1. prospect_attempts_select — sengaja DIKEMBARKAN dengan arm
--    prospect_activities_select (20260806050000:93-98) supaya attempt dan
--    effort-nya tak pernah beda jawaban: siapa yang boleh lihat attempt boleh
--    lihat aktivitasnya, dan sebaliknya.
DROP POLICY IF EXISTS prospect_attempts_select ON public.prospect_attempts;
CREATE POLICY prospect_attempts_select ON public.prospect_attempts FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (owner_employee_id, created_by)
       OR private.jwt_owns_lead(lead_id)
       OR (jwt_is_lead() AND EXISTS (
             SELECT 1 FROM leads l
              WHERE l.id = prospect_attempts.lead_id
                AND l.origin_division = jwt_division())));

-- 2. clients_select — tambah arm Sales lead di sebelah arm Account lead
--    (20260805030100). SEMUA arm lama dipertahankan (Finance, Account lead,
--    sales_pic / assigned_am / commission_pic / created_by).
DROP POLICY IF EXISTS clients_select ON public.clients;
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = sales_pic_id
       OR jwt_employee_id() = assigned_am_id
       OR jwt_employee_id() = commission_payment_pic_id
       OR jwt_employee_id() = created_by
       OR jwt_division() = 'Finance'
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

-- 3. installments_select — tambah arm Sales lead sejajar arm 'Finance' yang
--    sudah ada (20260729032805). `transactions_select` TIDAK disentuh di sini
--    (lihat catatan di bawah) tapi `installments` tidak mewarisi visibilitas
--    transaksinya secara otomatis — RLS di setiap tabel berdiri sendiri — jadi
--    tanpa baris ini panel cicilan Head Sales tetap kosong walau baris
--    transaksinya sendiri sudah kelihatan.
DROP POLICY IF EXISTS installments_select ON public.installments;
CREATE POLICY installments_select ON public.installments FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (verified_by, created_by)
       OR jwt_division() = 'Finance'
       OR (jwt_is_lead() AND jwt_division() = 'Sales')
       OR private.jwt_owns_transaction(transaction_id));

-- CATATAN — `transactions_select` SENGAJA TIDAK disentuh migrasi ini.
-- RENCANA_KINERJA_SALES.md §2 mendaftarnya sebagai gap keempat ("Sales hanya
-- lewat jwt_owns_client/jwt_owns_transaction, cocok employee_id bukan
-- divisi"), tapi audit terhadap riwayat migrasi menemukan itu sudah SALAH:
-- `20260730091540` (O46) menambah arm
-- `jwt_is_lead() AND private.jwt_division_owns_client(client_id)`, dan
-- `20260730120433` memperbaiki `jwt_division_owns_client` supaya
-- membandingkan DIVISI CDPS lewat `employee_claims()` (bukan `employees.divisi`
-- HRIS mentah). Arm itu sudah division-wide dengan benar untuk SEMUA divisi
-- termasuk Sales — seorang Head Sales sudah membaca transaksi setiap klien
-- yang salah satu PIC-nya (sales_pic/assigned_am/commission_pic/created_by)
-- sedivisi dengannya. Menulis ulang policy ini dengan arm sempit
-- `jwt_division()='Sales'` akan MEMBUANG `jwt_division_owns_client` dan
-- menyempitkan bacaan Lead divisi LAIN (mis. Account) yang sudah benar sejak
-- 2026-07-30 — regresi, bukan perbaikan. Dibiarkan apa adanya.

COMMENT ON POLICY prospect_attempts_select ON public.prospect_attempts IS
  'S-01 (Kinerja Sales) — arm Sales lead ditambahkan; dikembarkan dengan '
  'prospect_activities_select supaya attempt dan effort-nya tak pernah beda jawaban.';
COMMENT ON POLICY clients_select ON public.clients IS
  'S-01 (Kinerja Sales) — arm Sales lead ditambahkan di sebelah arm Account lead.';
COMMENT ON POLICY installments_select ON public.installments IS
  'S-01 (Kinerja Sales) — arm Sales lead ditambahkan sejajar arm Finance.';
