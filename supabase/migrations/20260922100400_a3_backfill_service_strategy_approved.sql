-- ===========================================================================
-- A-3 · Backfill — Service ber-STRG- `Aktif` yang masih `[Awaiting Onboarding]`
-- ===========================================================================
--
-- ## Cacat yang ditambal
--
-- Jalur pengiriman yang diputuskan (STRG- M6A + Plan M6B) tidak pernah
-- menyentuh mesin status `service`. Yang menyentuhnya jalur lama `STR-`, dan
-- jalur itu sudah di-hide (`SHOW_LEGACY_STR_PATH = false`). Akibatnya
-- `services.status` tidak pernah bergerak dan `account.guardBriefCreation`
-- menolak setiap Brief dengan
-- `[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]`
-- **padahal STRG--nya sudah `Aktif`** — keluhan Account #5.
--
-- Kode yang sudah dibetulkan (`strategi.approveStrategi`) hanya mengurus
-- persetujuan BARU. Baris yang sudah mentok sebelum betulan ini mendarat tidak
-- akan pernah bergerak sendiri: tidak ada persetujuan kedua untuk memicunya,
-- dan Strategi yang sudah `Aktif` tidak bisa disetujui ulang. Jadi mereka
-- didorong di sini, sekali.
--
-- ## Kenapa lewat `sm_transition`, bukan `UPDATE`
--
-- Aturan rumah #2/#3: nol status yang ditulis lewat update mentah, dan setiap
-- transisi meninggalkan baris `audit_log` yang tidak bisa dihapus. `UPDATE
-- services SET status = ...` melewati validasi edge, gerbang peran, DAN baris
-- auditnya sekaligus — dan justru riwayat itulah sumber seluruh metrik durasi
-- onboarding. Aktornya `SISTEM`, pola yang sama dengan `leads_unrespon_tick`
-- (20260911060000), supaya jelas di audit bahwa yang mendorong adalah migrasi
-- ini dan bukan seorang AM.
--
-- ## Cakupan — hanya yang memang tergerbang
--
-- Layanan Direct punya edge sendiri (`[Awaiting Onboarding] → [Briefed]`,
-- STATE_MACHINES §6) dan tidak pernah menunggu Strategi; mendorongnya ke
-- `[Strategy Approved]` akan melabeli ulang layanan yang jalurnya tidak memuat
-- state itu. Predikat gerbang di bawah adalah cermin SQL dari `effectiveGate`
-- (`packages/domain/src/plangate_rules.ts`) dan `guardBriefCreation`: override
-- per-engagement menang, lalu keputusan G-B, lalu tier katalog. Layanan
-- `ditentukan_am` yang G-B-nya belum dijawab TIDAK didorong — gerbangnya
-- menolaknya dengan alasan lain (`MSG_PLAN_DETERMINATION_REQUIRED`) dan
-- memindahkan statusnya tidak menjawab apa pun.
--
-- Idempoten: kriterianya status + keberadaan STRG- `Aktif`, nol kolom penanda.
-- Jalan kedua atas DB yang sama menemukan nol baris.
--
-- Aditif, nol penghapusan. Rujukan: docs/prd/CDPS_Module6A_Strategi.md §5.7,
-- docs/handoff/HANDOFF_FEEDBACK_OD_LANJUT_20260907.md §3 (A-3).
-- ===========================================================================

DO $$
DECLARE
    r        record;
    res      jsonb;
    v_moved  integer := 0;
BEGIN
    FOR r IN
        SELECT sv.id
          FROM services sv
          JOIN contracts ct ON ct.id = sv.contract_id
          LEFT JOIN service_plan_gate g ON g.service_id = sv.id
         WHERE sv.status = '[Awaiting Onboarding]'
           AND EXISTS (SELECT 1 FROM strategi s
                        WHERE s.contract_id = ct.id AND s.status = 'Aktif')
           AND CASE
                 WHEN sv.requires_strategy_plan_override IS NOT NULL
                      THEN sv.requires_strategy_plan_override
                 WHEN g.keputusan_am IS NOT NULL
                      THEN g.keputusan_am = 'butuh_plan'
                 ELSE sv.plan_tier = 'plan_wajib'
               END
         ORDER BY sv.id ASC
    LOOP
        res := sm_transition('service', 'service', 'services',
                             'id', 'status', r.id, '[Strategy Approved]',
                             'SISTEM', true, false);
        IF NOT (res ->> 'ok')::boolean THEN
            RAISE EXCEPTION 'a3_backfill: % -> [Strategy Approved] gagal: %', r.id, res;
        END IF;
        v_moved := v_moved + 1;
    END LOOP;

    RAISE NOTICE 'A-3 backfill: % Service didorong ke [Strategy Approved]', v_moved;
END $$;
