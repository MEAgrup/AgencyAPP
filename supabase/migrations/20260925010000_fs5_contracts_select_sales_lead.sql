-- ============================================================================
-- FS-5 (Feedback tim Sales 2026-09-08 #5) — Head Sales bisa membaca jendela
-- kontrak se-divisinya.
--
-- KELUHANNYA. "Buat supaya terlihat masa durasi kontraknya berapa lama. kita
-- kemarin ada perubahan sistem untuk durasi, ini untuk memastikan supaya tidak
-- salah. Team sales juga perlu bisa melihat klien yg didaftarkan oleh mereka.
-- Head sales bisa melihat semua client list."
--
-- KENAPA LENGAN INI, DAN KENAPA HANYA SATU LENGAN.
-- `contracts_select` (20260807120000, baris 220) sudah memakai
-- `private.jwt_owns_client(client_id)` — yang mencakup `sales_pic_id`,
-- `assigned_am_id`, `commission_payment_pic_id`, dan `created_by`. Komentarnya
-- menyatakan maksudnya verbatim: "kontrak adalah dokumen kesepakatan: Sales
-- yang menutupnya dan Finance yang menagih terminnya memang perlu melihat
-- durasi & jendelanya." Jadi sales STAFF sudah tercakup sejak hari pertama;
-- tidak ada yang perlu ditambahkan untuknya.
--
-- Yang HILANG adalah Head Sales. `clients_select` sudah punya
-- `jwt_is_lead() AND jwt_division() = 'Sales'` sejak S-01
-- (20260901010000_rls_sales_lead_scope.sql), begitu juga `transactions_select`
-- dan `installments_select`. `contracts_select` dilewati saat itu — kontraknya
-- belum punya UI mana pun, jadi ketiadaannya tidak terlihat. Akibatnya Head
-- Sales melihat KLIEN se-divisinya tapi tidak DURASI kontraknya: setengah
-- jawaban, dan setengah yang hilang justru yang diminta feedback ini.
--
-- Lengan Finance sengaja TIDAK ditambahkan meski komentar 20260807120000
-- menyebut Finance: Finance sudah lolos lewat `jwt_owns_client` sebagai PIC
-- Komisi/Pembayaran pada klien yang ia tagih, dan lengan se-divisi untuk
-- Finance adalah pelebaran yang tidak ada yang minta. Divisi eksekusi
-- (Creative/Ads/KOL) tetap tanpa lengan; Strategi di atas kontrak tetap
-- dijaga `strategi_select` sendiri.
--
-- Nol tabel, nol kolom, nol prefix, nol mesin, nol event ⇒ gate
-- 147/41/32/73 TETAP. Aditif murni (satu lengan OR), aman mendahului deploy kode.
-- ============================================================================

DROP POLICY IF EXISTS contracts_select ON public.contracts;
CREATE POLICY contracts_select ON public.contracts FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       -- S-01 sejajar: Head Sales/SPV melihat se-divisinya, sama seperti pada
       -- clients / transactions / installments.
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

COMMENT ON TABLE public.contracts IS
  'O57 Contract (CTR-). Scope baca = scope klien (private.jwt_owns_client) + Account lead + Sales lead (FS-5).';
