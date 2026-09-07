-- ============================================================================
-- A-3 (backfill) — Service yang Strategi-nya (STRG-) sudah `Aktif` tapi
-- statusnya masih `[Awaiting Onboarding]`.
--
-- AKARNYA, dan kenapa backfill-nya wajib ada
-- ---------------------------------------------------------------------------
-- Jalur pengiriman yang DIPUTUSKAN (STRG- M6A + Plan M6B) tidak pernah
-- menyentuh mesin status `service`. Yang menyentuhnya jalur lama STR-
-- (`account.approveStrategy`, M6 §4 Rule 3), dan jalur itu di-hide
-- (`SHOW_LEGACY_STR_PATH = false`). Akibatnya `services.status` tidak pernah
-- bergerak dan `account.guardBriefCreation` menolak setiap Brief dengan
-- `[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum
-- dibuatkan Brief]` PADAHAL STRG--nya `Aktif` — keluhan Account #5.
--
-- Sisi kode ditutup di commit yang sama: `strategi.approveStrategi` sekarang
-- mendorong Service `[Awaiting Onboarding]` → `[Strategy Approved]` di
-- transaksi yang sama. Tapi itu hanya berlaku untuk persetujuan BERIKUTNYA.
-- Setiap Strategi yang sudah disetujui SEBELUM commit ini tetap meninggalkan
-- Service-nya menggantung, dan tidak ada tombol "setujui ulang" — sebuah
-- Strategi `Aktif` tidak bisa kembali ke `Diajukan` (STATE_MACHINES §6b).
-- Tanpa backfill ini, perbaikannya tidak menyentuh satu pun klien yang sudah
-- berjalan.
--
-- KENAPA LEWAT `sm_transition`, BUKAN `UPDATE services SET status = ...`
-- ---------------------------------------------------------------------------
-- Aturan rumah #2/#3: tidak ada satu pun status yang ditulis dengan update
-- mentah, dan setiap transisi meninggalkan baris audit yang tidak bisa
-- dihapus. Sebuah `UPDATE` di sini akan memindahkan status TANPA baris
-- `audit_log`, dan setiap metrik durasi di CDPS diturunkan dari stempel waktu
-- baris-baris itu — Service hasil backfill akan tampak "tidak pernah
-- di-onboard" selamanya. Aktornya `SISTEM`, pola yang sama dengan
-- `wrr_monday_job` (20260813080000) dan `leads_unrespon_tick`
-- (20260911060000).
--
-- Edge `service: [Awaiting Onboarding] → [Strategy Approved]` punya
-- `require_lead = false` (`20260723055732_statemachine.sql`), jadi dua argumen
-- peran terakhir `false, false`. Jebakan yang sudah dicatat di
-- 20260911060000: `sm_transition` MENGEMBALIKAN `{ok:false}`, ia tidak
-- melempar — jadi setiap panggilan di bawah diperiksa dan gagal dengan keras.
-- Backfill yang "sukses" tanpa memindahkan siapa pun adalah kegagalan yang
-- paling mahal di sini: ia menutup tiketnya tanpa menutup cacatnya.
--
-- LINGKUP PEMILIHAN
-- ---------------------------------------------------------------------------
-- Lewat `contract_id`, karena O57 memindahkan Strategi dari `service_id` ke
-- `contract_id`: satu perjanjian bisa menaungi beberapa layanan yang dibeli,
-- dan persetujuan Strategi-nya membuka semuanya sekaligus. Hanya baris yang
-- BENAR-BENAR masih `[Awaiting Onboarding]` yang dipilih, jadi migrasi ini
-- idempoten: jalan kedua menemukan nol kandidat.
--
-- Gerbang angka TIDAK berubah: nol tabel, nol prefix, nol mesin, nol event.
-- Nol kolom baru — hanya baris status yang digerakkan lewat mesinnya sendiri.
-- ============================================================================

DO $$
DECLARE
    r        record;
    res      jsonb;
    v_jumlah integer := 0;
BEGIN
    FOR r IN
        SELECT sv.id
          FROM services sv
          JOIN strategi s ON s.contract_id = sv.contract_id
         WHERE sv.status = '[Awaiting Onboarding]'
           AND s.status = 'Aktif'
         ORDER BY sv.id ASC
    LOOP
        res := sm_transition('service', 'service', 'services',
                             'id', 'status', r.id, '[Strategy Approved]',
                             'SISTEM', false, false);
        IF NOT (res ->> 'ok')::boolean THEN
            RAISE EXCEPTION 'A-3 backfill: % -> [Strategy Approved] gagal: %', r.id, res;
        END IF;
        v_jumlah := v_jumlah + 1;
    END LOOP;

    RAISE NOTICE 'A-3 backfill: % Service didorong ke [Strategy Approved].', v_jumlah;
END
$$;
