-- ============================================================================
-- Antrean Intake Account SELALU KOSONG untuk SPV/Head Account (M6 §3 Rule 1).
--
-- Kembaran persis `20260804035500` (arm Finance), satu divisi sebelahnya —
-- ditemukan dengan cara yang sama: menjalankan alur pemilik lewat HTTP sungguhan
-- saat memasang dropdown penunjukan AM. Gejalanya pola paling berbahaya di repo
-- ini: **kosong tanpa error**.
--
-- MEKANISMENYA. `clients_select` (baseline 20260723064438, diperluas
-- 20260804035500) hanya membuka baris lewat kepemilikan PERORANGAN
-- (`sales_pic_id` / `assigned_am_id` / `commission_payment_pic_id` /
-- `created_by`), oversight (`jwt_can_read_all()`), dan satu arm divisi:
-- Finance. Tidak ada arm Account. Sedangkan:
--
--   * `account.intakeQueue` (§3 Rule 1) melist klien yang SUDAH dirilis TAPI
--     `assigned_am_id IS NULL` — jadi baris itu, secara definisi, tidak dimiliki
--     AM mana pun. Di bawah `readAsActor` (O37) seorang SPV/Head Account membaca
--     NOL baris: antreannya kosong, padahal §3 Rule 2 menyatakan dialah
--     SATU-SATUNYA role (selain Director) yang boleh menunjuk AM. Penunjukan AM
--     karena itu tidak bisa dilakukan lewat UI sama sekali.
--   * `account.workload` (§3 Rule 5) menghitung klien aktif per AM sebagai
--     referensi saat menugaskan. Seorang lead hanya "melihat" klien yang
--     kebetulan miliknya sendiri, jadi angka referensinya salah — dan salah
--     ke arah yang tidak kelihatan salah.
--
-- Bukti empiris (PG16 lokal, 55 migrasi + seed, satu klien released dengan
-- `assigned_am_id IS NULL`), lewat HTTP nyata ke `apps/api`:
--
--     GET /account/intake   sebagai Account lead -> {"data":[]}   <-- antrean mati
--     GET /account/workload sebagai Account lead -> 1 baris (hanya klien sendiri)
--     GET /account/intake   sebagai Director     -> baris klien   (kontrol)
--
-- KENAPA ARM-NYA `jwt_is_lead() AND jwt_division() = 'Account'`, BUKAN
-- `jwt_division() = 'Account'` seperti arm Finance:
--   - Ini persis pola universal Role Matrix (CLAUDE.md #6 / Fase 0 §4):
--     **Staff = data sendiri; Lead/SPV = seluruh divisi.** Untuk Account,
--     "seluruh divisi" memang berarti seluruh klien.
--   - Gate domain yang dilayaninya juga tepat itu: `canReadIntake` =
--     Account LEAD ∨ OD ∨ Director; seorang AM staff justru DITOLAK (403) di
--     antrean intake. Membuka arm untuk semua Account staff akan melebihi gate
--     app-layer-nya sendiri tanpa satu pun pembaca yang membutuhkannya.
--   - AM staff tidak kehilangan apa pun: klien miliknya tetap terbaca lewat arm
--     `assigned_am_id` yang sudah ada (M4 §6 "own clients").
--   Arm Finance memang lebih lebar (semua level) karena M5 §8.1 menyerahkan
--   antrean verifikasi ke Finance STAFF; di sini yang punya antrean adalah lead.
--
-- Sifat perubahan: hanya MEMPERLUAS SELECT, memakai helper yang sudah ada
-- (`jwt_is_lead()`, `jwt_division()`), tanpa permukaan RPC baru. Policy tulis
-- tidak disentuh: `clients` tetap default-deny untuk write, semua tulis lewat
-- RPC SECURITY DEFINER (`sm_transition` / service role).
-- ============================================================================

DROP POLICY IF EXISTS clients_select ON public.clients;
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = sales_pic_id
       OR jwt_employee_id() = assigned_am_id
       OR jwt_employee_id() = commission_payment_pic_id
       OR jwt_employee_id() = created_by
       OR jwt_division() = 'Finance'
       OR (jwt_is_lead() AND jwt_division() = 'Account'));
