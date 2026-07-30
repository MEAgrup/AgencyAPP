-- ============================================================================
-- O46 — dua arm visibility yang lebih SEMPIT dari Go dipulihkan, mengikuti
-- **PRD Role Matrix** (`CLAUDE.md` §6: "Staff = own data only; Lead/SPV =
-- division-wide; OD = read-only everywhere; Director = full"), bukan paritas Go
-- literal.
--
-- Keputusan pemilik 2026-07-30 (DECISIONS.md): arah "ikut PRD Role Matrix".
-- Yang ditutup di sini adalah dua dari tiga arm yang O46 sebut:
--
--   (a) `transactions_select` tidak punya arm Sales-Lead. Go `trxVisibility`
--       memberi Sales **Lead** seluruh transaksi klien sales-nya; RLS hanya
--       memberi kepemilikan per-orang (`private.jwt_owns_client`), jadi SPV Sales
--       melihat lebih sedikit daripada era Go DAN lebih sedikit daripada yang PRD
--       janjikan.
--   (b) `audit_log_select` = `jwt_can_read_all() OR actor_employee_id =
--       jwt_employee_id()` — tidak ada arm lead sama sekali, jadi seorang lead
--       tidak bisa membaca jejak audit divisinya sendiri.
--
--   (c) arm Account "hanya setelah rilis" (M5 §5 Rule 2) TIDAK disentuh migrasi
--       ini — ia sudah ditangani di lapisan aplikasi (`loadTransactionAggregate`,
--       mengikuti O37 opsi c) dan itu tetap tempat yang benar: ia bergantung pada
--       `released_to_account_at` relatif waktu baca, bukan pada peran aktor.
--
-- SIFAT PERUBAHAN: **memperluas baca**, tidak pernah menyempitkan. Sama kelasnya
-- dengan 20260729031525 dan 20260729032805. Policy TULIS tidak disentuh (tetap
-- default-deny; tulis lewat RPC SECURITY DEFINER). Helper baru hidup di schema
-- `private` (dihardening oleh 20260727072443), jadi TIDAK menambah permukaan RPC
-- publik.
--
-- ----------------------------------------------------------------------------
-- Kenapa arm audit di-scope per DIVISI AKTOR, bukan per entitas yang boleh
-- dibaca — batas yang dinyatakan, bukan disembunyikan:
--
-- Varian "staff boleh baca audit entitas yang boleh ia lihat" terdengar lebih
-- baik dan akan membuat panel riwayat Asset Creative penuh untuk staff. Ia TIDAK
-- diimplementasikan, dan itu keputusan sadar: `audit_log` polimorfik
-- (`entity_type` + `entity_id`), dan domain menulis **~30 `entity_type` berbeda**.
-- Memetakan visibilitas per tipe berarti CASE 30 cabang yang, begitu satu tipe
-- baru lahir tanpa cabangnya, **gagal diam-diam** — persis kelas cacat O43/O41
-- (route menjawab 200, halaman kosong, CI hijau). Menukar satu gap yang
-- DINYATAKAN dengan 30 gap yang TIDAK KELIHATAN bukan perbaikan.
--
-- Konsekuensi yang harus diketahui: **staff tetap hanya melihat entri audit yang
-- IA tulis.** Panel riwayat Asset Creative tetap parsial bagi staff — sekarang
-- itu perilaku PRD ("Staff = own data only"), bukan penyimpangan. Kalau panel itu
-- harus penuh bagi staff, itu perubahan PRD + tiket sendiri, bukan tambalan RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: apakah `p_employee_id` berada di divisi yang sama dengan aktor JWT?
-- Dipakai untuk arm "Lead/SPV = division-wide". Fail-closed: karyawan tidak
-- ditemukan / divisi NULL ⇒ false.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.jwt_same_division(p_employee_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.employee_id = p_employee_id
      AND e.divisi IS NOT NULL
      AND e.divisi = public.jwt_division()
  )
$$;

COMMENT ON FUNCTION private.jwt_same_division(text) IS
  'O46: true bila karyawan p_employee_id sedivisi dengan aktor JWT. Fail-closed pada karyawan tak ditemukan atau divisi NULL. Dipakai arm "Lead/SPV = division-wide" PRD Role Matrix.';

-- ----------------------------------------------------------------------------
-- Helper: apakah klien `p_client_id` dipegang oleh seseorang SEDIVISI dengan
-- aktor JWT? Ini versi divisi dari `private.jwt_owns_client` (yang per-orang).
-- Keempat kolom PIC-nya sengaja SAMA dengan `jwt_owns_client` supaya kedua
-- helper tidak bisa menyimpang satu dari yang lain tanpa terlihat.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.jwt_division_owns_client(p_client_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.employees e
      ON e.employee_id IN (c.sales_pic_id, c.assigned_am_id,
                           c.commission_payment_pic_id, c.created_by)
    WHERE c.id = p_client_id
      AND e.divisi IS NOT NULL
      AND e.divisi = public.jwt_division()
  )
$$;

COMMENT ON FUNCTION private.jwt_division_owns_client(text) IS
  'O46: versi divisi dari private.jwt_owns_client — true bila salah satu PIC klien sedivisi dengan aktor JWT. Empat kolom PIC-nya sengaja identik dengan jwt_owns_client.';

-- ----------------------------------------------------------------------------
-- (a) transactions: tambah arm Lead/SPV division-wide.
--     Arm existing dipertahankan APA ADANYA — ini penambahan, bukan penulisan
--     ulang, supaya paritas Finance yang ditutup 20260729032805 tidak hilang.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR jwt_division() = 'Finance'
       OR private.jwt_owns_client(client_id)
       -- O46 (a): Lead/SPV = division-wide (PRD Role Matrix)
       OR (jwt_is_lead() AND private.jwt_division_owns_client(client_id)));

-- ----------------------------------------------------------------------------
-- (b) audit_log: tambah arm Lead/SPV division-wide (per divisi AKTOR entri).
--     Staff tetap own-only — itu PRD, lihat catatan panjang di atas.
--     Tabel ini append-only (trigger `audit_log_no_delete`); nol policy tulis.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR actor_employee_id = jwt_employee_id()
       -- O46 (b): Lead/SPV = division-wide (PRD Role Matrix)
       OR (jwt_is_lead() AND private.jwt_same_division(actor_employee_id)));
