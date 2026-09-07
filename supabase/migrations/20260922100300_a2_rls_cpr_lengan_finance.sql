-- ============================================================================
-- A-2 — Finance tidak bisa melihat Creator Payment Request yang belum pernah ia
-- sentuh. Ayam-telur, dan ia yang membuat keluhan Finance #2 tidak bisa dijawab
-- hanya dengan menambah halaman.
--
-- GEJALA: `kol.canProcessPaymentRequest` (`kol.ts:263`) MENGIZINKAN seluruh
-- divisi Finance — `actor.role.director || actor.role.division === 'Finance'`.
-- Gerbang domainnya benar. Yang membantahnya RLS:
-- `creator_payment_requests_select` (`20260723064438_rls_baseline.sql:339`)
-- hanya membuka baris kepada `(requested_by, paid_by, created_by)`. Jadi
-- seorang staf Finance yang belum pernah menyentuh sebuah CPR tidak bisa
-- MEMBUKA-nya, dan satu-satunya cara ia bisa menyentuhnya adalah dengan
-- membukanya lebih dulu.
--
-- PROBE, sebelum satu baris SQL di bawah ditulis (`SET LOCAL ROLE authenticated`
-- + klaim asli, satu CPR yang diajukan KOL):
--
--   Finance staff  -> creator_payment_requests ....... 0 baris
--   Finance LEAD   -> creator_payment_requests ....... 0 baris   ← ikut buta
--   pengaju KOL    -> CPR miliknya .................... 1 baris
--   Finance staff  -> clients .......................... 1 baris
--   Finance staff  -> creator_bookings ................. 0 baris
--
-- Catatan atas dua angka terakhir: rencana A-2 menyebut "staf Finance", tapi
-- probe-nya menunjukkan **lead Finance sama butanya** — jadi lengan yang
-- ditambahkan di bawah TIDAK dibatasi `jwt_is_lead()`. Membatasinya ke lead
-- akan meninggalkan cacat yang sama untuk staf yang justru mengerjakan antrean
-- itu sehari-hari, dan `canProcess` (`req.ts:146`) memang sengaja membuka
-- Creator Payment Approval ke divisi Finance SEBAGAI DIVISI, bukan ke satu
-- orang bernama.
--
-- KENAPA LENGAN POLICY, BUKAN FUNGSI `private.*`
-- ---------------------------------------------------------------------------
-- O52 memutuskan (b) — fungsi `private.*` — untuk kasus yang bentuknya BEDA:
-- di sana sebuah read model men-join tabel klien hanya untuk MENGAMBIL SATU
-- KOLOM, dan divisi eksekusi tidak butuh membaca record kliennya. Di sini yang
-- dibutuhkan Finance adalah **baris CPR itu sendiri** — seluruhnya, untuk
-- dibuka, dinilai, lalu dibayar; itu memang pekerjaan mereka menurut M9. Tidak
-- ada "satu kolom" yang bisa diberikan sebagai gantinya, dan membungkus seluruh
-- baris di dalam fungsi `private.*` sama dengan melebarkan policy-nya, hanya
-- dengan cara yang lebih sulit dibaca.
--
-- Jadi ini kasus opsi (a) yang sah, dan cakupannya dijaga sempit: lengan
-- divisi Finance memakai `public.jwt_division()` yang sudah ada
-- (`rls_baseline.sql:77`). Nol tabel baru ⇒ nol counter berubah
-- (146/40/31/73 TETAP). Tabel LAIN tidak disentuh: `creator_bookings` tetap
-- tertutup bagi Finance, karena Finance tidak perlu membaca papan booking KOL —
-- nominal yang mereka butuh ada di CPR-nya sendiri.
--
-- Policy lama di-DROP lalu dibuat ulang (bukan `CREATE OR REPLACE`, yang tidak
-- berlaku untuk POLICY), dan itu satu-satunya cara menambah lengan.
-- ============================================================================

DROP POLICY IF EXISTS creator_payment_requests_select ON public.creator_payment_requests;

CREATE POLICY creator_payment_requests_select ON public.creator_payment_requests
FOR SELECT TO authenticated
USING (
  jwt_can_read_all()
  OR jwt_employee_id() IN (requested_by, paid_by, created_by)
  -- A-2: divisi Finance, level apa pun. Inilah yang memutus ayam-telurnya.
  OR public.jwt_division() = 'Finance'
);

COMMENT ON POLICY creator_payment_requests_select ON public.creator_payment_requests IS
  'A-2 (feedback OD 2026-09-07, Finance #2) — lengan divisi Finance ditambahkan. '
  'Sebelumnya hanya (requested_by, paid_by, created_by), sehingga staf DAN lead '
  'Finance tidak bisa membuka CPR yang belum pernah mereka sentuh — padahal '
  'kol.canProcessPaymentRequest sudah mengizinkan seluruh divisi Finance. '
  'Diverifikasi probe: 0 baris sebelum, 1 sesudah.';
