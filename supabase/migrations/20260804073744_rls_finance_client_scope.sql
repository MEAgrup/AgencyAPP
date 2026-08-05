-- ============================================================================
-- QA finance 2026-08-04 — lanjutan 20260729032805: `clients_select` tidak punya
-- arm Finance, jadi SETIAP read M5 yang men-join `clients` mengembalikan NOL
-- baris untuk Finance. Yang paling terasa: **Reminder Pembayaran (M5 §6)** —
-- halaman yang PRD §8.1 nyatakan dimiliki Admin & Finance — selalu kosong.
--
-- Migrasi 20260729032805 menutup tiga tabel M5 (`transactions`, `installments`,
-- `payment_verifications`) untuk Finance semua level, tapi `clients_select`
-- (baseline 20260723064438) tetap hanya:
--
--     jwt_can_read_all() OR jwt_employee_id() IN (sales_pic_id, assigned_am_id,
--                                                 commission_payment_pic_id, created_by)
--
-- Tidak ada arm divisi sama sekali. Karena `reminderDashboard` (M5 §6) dan daftar
-- "Outstanding, No Due Date" (§6 Rule 4) keduanya `join clients c on c.id =
-- t.client_id` untuk mengambil `toko` + `sales_pic_id` (§6 Rule 2: tiap baris
-- menampilkan Klien dan PIC), join itu MEMBUANG semua baris begitu klien-nya tak
-- terlihat. Gejalanya persis pola yang paling berbahaya menurut 20260729032805:
-- **kosong tanpa error**, jadi tidak kelihatan rusak.
--
-- Bukti empiris (PG16 lokal, 45 migrasi ter-apply, satu TRX [Terverifikasi -
-- Sebagian] dengan 2 installment berjadwal), mekanisme klaim sama dengan
-- `supabase/tests/rls_checks.sql`:
--
--     Finance staff  -> transactions 1, installments 2, clients 0   <-- join mati
--     Finance lead   -> clients 0                                   <-- lead pun
--     Director       -> clients 1  (kontrol)
--
-- Kenapa ini perluasan yang benar, bukan pelonggaran di luar PRD:
--   - M5 §5 Rule 2 menyatakan eksplisit selama `[Menunggu Verifikasi]` "the Client
--     Record is **visible to Finance only**" — jadi PRD memang memberi Finance
--     baca Client Record, dan RLS-nya justru satu-satunya yang tidak.
--   - M5 §6 Rule 2 mewajibkan baris dashboard menampilkan Klien + PIC.
--   - Oracle Go tidak men-scope baca dengan RLS: `Dashboard`/`Queue` memakai
--     kueri biasa di belakang gate app-layer Finance/OD/Director, jadi Finance
--     memang melihat seluruh klien di jalur M5. Ini memulihkan paritas itu.
--
-- Sifat perubahan: hanya MEMPERLUAS SELECT (satu arm `jwt_division() =
-- 'Finance'`), memakai helper yang sudah ada — tidak ada permukaan RPC baru.
-- Policy tulis tidak disentuh: `clients` tetap default-deny untuk write, semua
-- tulis lewat RPC SECURITY DEFINER.
-- ============================================================================

DROP POLICY IF EXISTS clients_select ON public.clients;
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = sales_pic_id
       OR jwt_employee_id() = assigned_am_id
       OR jwt_employee_id() = commission_payment_pic_id
       OR jwt_employee_id() = created_by
       OR jwt_division() = 'Finance');
