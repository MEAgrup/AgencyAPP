-- ============================================================================
-- O41 — paritas RLS M5 dengan Go `trxVisibility`: Finance **staff** ikut melihat
-- antrean verifikasi, bukan hanya Finance lead.
--
-- Temuan (2026-07-28, saat menyiapkan port `GET /finance/queue`): tiga policy
-- baseline (20260102000003) memberi baca ke Finance hanya lewat arm
-- `jwt_is_lead() AND jwt_division() = 'Finance'` — **lead saja**:
--
--     transactions_select, installments_select, payment_verifications_select
--
-- Sedangkan sistem Go memberi Finance **semua level** akses penuh:
--
--     backend/internal/module5_finance/transaction.go — trxVisibility():
--       "Finance (staff/lead) -> all (they own the queue)"
--
-- dan `canVerifyPayment` (M5 §8.1) memang mengizinkan Finance **staff**
-- menetapkan Payment Status. PERMISSIONS.md M5 juga menyebut "Only Finance sets
-- authoritative Payment Status" + "Pre-verification records visible to Finance
-- only" — tanpa membatasi ke level lead. Jadi RLS-nya yang menyimpang, bukan
-- Go-nya.
--
-- Akibat kalau tidak ditutup: begitu route baca M5 di-port memakai `readAsActor`
-- (house rule #5), Finance staff — yaitu pengguna utama halaman `/finance` —
-- mendapat antrean **KOSONG tanpa error**. Itu lebih buruk daripada 404 yang
-- sekarang: tidak kelihatan rusak. Tulis TIDAK terpengaruh (lewat RPC SECURITY
-- DEFINER), jadi tanpa migrasi ini seorang Finance staff bisa mem-verifikasi
-- pembayaran yang tidak bisa ia baca.
--
-- Bukti empiris (PG16 lokal, 36 migrasi ter-apply, satu TRX ber-status
-- `[Menunggu Verifikasi]`), memakai mekanisme klaim yang sama dengan
-- `supabase/tests/rls_checks.sql`:
--
--     superuser (kontrol)            -> 1 baris
--     Finance staff (level='staff')  -> 0 baris   <-- antrean kosong
--     Finance lead  (level='lead')   -> 1 baris
--     Director (kontrol)             -> 1 baris
--
-- Sifat perubahan: sama dengan 20260102000009 — hanya MEMPERLUAS baca supaya
-- RLS = predikat sistem lama yang sudah lolos UAT W1/W3, bukan menambah akses di
-- luar PRD. Policy tulis tidak disentuh (tetap default-deny; tulis lewat RPC).
-- Tidak ada helper baru, jadi tidak ada permukaan RPC baru (advisor lint 0029
-- tidak tersentuh); arm-nya memakai `jwt_division()` yang sudah ada.
--
-- CATATAN DEPLOY: per handoff cutover sesi 5 §1, 20260102000009 **belum**
-- di-apply ke `CDPS SG`. Setelah migrasi ini ada dua migrasi RLS yang menunggu
-- window deploy — apply keduanya berurutan (0009 lalu 0010), dan verifikasi
-- dengan probe di komentar atas.
-- ============================================================================

-- transactions: Finance semua level melihat seluruh transaksi (mereka pemilik
-- antrean verifikasi, termasuk record pra-verifikasi yang justru HANYA boleh
-- dilihat Finance).
DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR jwt_division() = 'Finance'
       OR private.jwt_owns_client(client_id));

-- installments: mengikuti transaksinya (jadwal cicilan adalah anak TRX yang
-- sama; Finance memverifikasi per-termin pada skema Termin / Bayar di Belakang).
DROP POLICY IF EXISTS installments_select ON public.installments;
CREATE POLICY installments_select ON public.installments FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (verified_by, created_by)
       OR jwt_division() = 'Finance'
       OR private.jwt_owns_transaction(transaction_id));

-- payment_verifications: jejak verifikasi yang Finance sendiri yang membuatnya.
DROP POLICY IF EXISTS payment_verifications_select ON public.payment_verifications;
CREATE POLICY payment_verifications_select ON public.payment_verifications FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (verified_by, created_by)
       OR jwt_division() = 'Finance');
