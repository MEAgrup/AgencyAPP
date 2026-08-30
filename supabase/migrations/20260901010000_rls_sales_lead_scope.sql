-- ============================================================================
-- S-01 (docs/handoff/RENCANA_KINERJA_SALES.md §2/§5) — Head Sales tidak pernah
-- dapat arm "Lead/SPV = division-wide" (CLAUDE.md #6 / PERMISSIONS.md §M0) untuk
-- EMPAT tabel inti Sales: `prospect_attempts`, `clients`, `transactions`,
-- `installments`. Pola repo (Finance `20260804073744`, Account
-- `20260805030100`, `prospect_activities` `20260806050000`) sudah memberi tiga
-- divisi lain arm `jwt_is_lead() AND jwt_division() = '<Divisi>'`; Sales-nya
-- terlewat setiap kali.
--
-- AKIBAT DIAM-DIAM. Setiap dashboard Head Sales yang dibaca lewat `readAsActor`
-- (RLS aktif) hanya melihat baris MILIKNYA SENDIRI — hijau, tanpa error, angka
-- salah. Persis kelas cacat 20260805060000 → 20260806050000. Kinerja Sales
-- (S-03/salesperf.ts) akan mewarisi bug ini kalau ini tidak ditutup lebih dulu.
--
-- EMPAT ARM:
--   1. `prospect_attempts_select` — dikembarkan SENGAJA dengan arm
--      `prospect_activities_select` (20260806050000:93-97): attempt dan
--      effort-nya (aktivitasnya) tidak boleh pernah beda jawaban untuk aktor
--      yang sama, atau panel effort SPV kosong sementara attempt-nya terlihat
--      (atau sebaliknya).
--   2. `clients_select` — arm sejajar arm 'Account' yang sudah ada
--      (20260805030100), SEMUA arm lama dipertahankan verbatim.
--   3. `transactions_select` — arm sejajar arm 'Finance' (definisi TERAKHIR
--      `20260730091540`/O46a, bukan baseline — lihat catatan §3 di bawah).
--   4. `installments_select` — arm sejajar arm 'Finance' (definisi TERAKHIR
--      `20260729032805`/O41, bukan baseline).
--
-- `private.jwt_owns_lead` / `private.jwt_owns_client` / `private.jwt_owns_transaction`
-- dipanggil BER-SKEMA (20260727072443 memindahkannya ke `private`) — memanggil
-- tanpa skema di sebuah CREATE POLICY baru (bukan ALTER FUNCTION) gagal resolve
-- kalau `private` tidak ada di search_path sesi migrasi, persis jebakan yang
-- dicatat di 20260729031525.
--
-- Sifat: MEMPERLUAS SELECT saja (menambah satu arm, mempertahankan semua arm
-- lama by name). Policy tulis tidak disentuh (default-deny; tulis lewat RPC).
-- Konsekuensi: Head Sales kini melihat data se-divisi di `/sales` dan
-- `/clients` — perbaikan cacat terhadap janji CLAUDE.md #6, bukan pelebaran
-- hak baru. Dicatat `docs/DECISIONS.md` 2026-08-29 (Kinerja Sales #1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. prospect_attempts_select — dikembarkan dengan prospect_activities_select.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS prospect_attempts_select ON public.prospect_attempts;
CREATE POLICY prospect_attempts_select ON public.prospect_attempts FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (owner_employee_id, created_by)
       OR private.jwt_owns_lead(lead_id)
       -- Lead/SPV = division-wide (CLAUDE.md #6): dikembarkan sengaja dengan
       -- arm prospect_activities_select supaya attempt dan effort-nya (yang
       -- dibaca dari attempt yang sama) tidak pernah beda jawaban.
       OR (jwt_is_lead() AND EXISTS (
             SELECT 1 FROM leads l
              WHERE l.id = prospect_attempts.lead_id
                AND l.origin_division = jwt_division())));

-- ---------------------------------------------------------------------------
-- 2. clients_select — arm Sales sejajar arm 'Account' yang sudah ada.
--    SEMUA arm lama (20260805030100) dipertahankan verbatim.
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
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

-- ---------------------------------------------------------------------------
-- 3. transactions_select — arm Sales sejajar arm 'Finance'.
--
--    KOREKSI atas §2 rencana: policy ini TIDAK lagi di baseline `:268` seperti
--    tercatat di sana — `20260729032805` (O41) melebarkan Finance ke semua
--    level, lalu `20260730091540` (O46a) menambah arm
--    `jwt_is_lead() AND private.jwt_division_owns_client(...)`. Dasarnya
--    dibangun dari definisi TERAKHIR itu (dibuktikan `scripts/db-rebuild.sh` +
--    `supabase/tests/rls_checks.sql` gagal saat memakai baseline stale — lihat
--    DECISIONS.md Kinerja Sales #1), bukan dari nomor baris rencana. Semua arm
--    lama dipertahankan verbatim; arm Sales baru berdiri sendiri (tidak
--    bergantung `jwt_division_owns_client`, yang membandingkan
--    `employees.divisi` HRIS mentah — bukan celah untuk ditutup di sini).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR jwt_division() = 'Finance'
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND private.jwt_division_owns_client(client_id))
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

-- ---------------------------------------------------------------------------
-- 4. installments_select — arm Sales sejajar arm 'Finance' (terakhir
--    didefinisikan `20260729032805`/O41, bukan baseline `:273` — Finance sudah
--    dilebarkan ke semua level di sana; arm Sales ditambahkan di atasnya).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS installments_select ON public.installments;
CREATE POLICY installments_select ON public.installments FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (verified_by, created_by)
       OR jwt_division() = 'Finance'
       OR private.jwt_owns_transaction(transaction_id)
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

COMMENT ON POLICY prospect_attempts_select ON public.prospect_attempts IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca attempt seluruh divisinya — dikembarkan dengan prospect_activities_select.';
COMMENT ON POLICY clients_select ON public.clients IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca klien seluruh divisinya, sejajar arm Account.';
COMMENT ON POLICY transactions_select ON public.transactions IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca transaksi seluruh divisinya, sejajar arm Finance.';
COMMENT ON POLICY installments_select ON public.installments IS
  'S-01 (Kinerja Sales): Head/SPV Sales membaca cicilan seluruh divisinya, sejajar arm Finance.';
