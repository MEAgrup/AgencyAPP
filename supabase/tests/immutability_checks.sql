-- Fase-0 DB invariant check: append-only history (plain psql; run with -v ON_ERROR_STOP=1).
--
-- Verifies house rule #3 (immutable history — no UPDATE/DELETE path) directly at
-- the Postgres level via the forbid_mutation() triggers, mirroring the Go audit
-- engine and the handoff smoke test. Runs in a transaction and ROLLBACKs so it
-- leaves no rows behind.
--
-- audit_log + notifications have no FKs, so their guards are exercised
-- behaviourally (real INSERT, then blocked UPDATE/DELETE). The snapshot tables
-- carry FKs, so their guards are asserted structurally here; full behavioural
-- coverage arrives with the Alpha Digital e2e suite (Tech Appendix §G).
--
-- See ident_checks.sql for why these are plain-SQL (not pgTAP) at Fase 0.

BEGIN;

DO $$
DECLARE
    guarded boolean;
    t text;
BEGIN
    ---------------------------------------------------------------------------
    -- audit_log: append allowed; UPDATE and DELETE both forbidden.
    ---------------------------------------------------------------------------
    INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    VALUES ('CI', 'CI-IMMUT-1', 'CI', 'test', now(), 'CI');

    guarded := true;
    BEGIN
        UPDATE audit_log SET action = 'tampered' WHERE entity_id = 'CI-IMMUT-1';
        guarded := false; -- only reached if the trigger did NOT fire
    EXCEPTION WHEN others THEN
        guarded := true;
    END;
    ASSERT guarded, 'audit_log UPDATE must be forbidden by forbid_mutation()';

    guarded := true;
    BEGIN
        DELETE FROM audit_log WHERE entity_id = 'CI-IMMUT-1';
        guarded := false;
    EXCEPTION WHEN others THEN
        guarded := true;
    END;
    ASSERT guarded, 'audit_log DELETE must be forbidden by forbid_mutation()';

    ---------------------------------------------------------------------------
    -- notifications: append allowed; read_at UPDATE allowed; DELETE forbidden.
    ---------------------------------------------------------------------------
    INSERT INTO notifications
        (recipient_employee_id, event_type, entity_type, entity_id, actor_employee_id, deep_link, created_at, created_by)
    VALUES ('CI', 'EvCiTest', 'CI', 'CI-NOTIF-1', 'CI', '/x', now(), 'CI');

    -- Marking as read is the one permitted mutation — must NOT raise.
    UPDATE notifications SET read_at = now() WHERE entity_id = 'CI-NOTIF-1';

    guarded := true;
    BEGIN
        DELETE FROM notifications WHERE entity_id = 'CI-NOTIF-1';
        guarded := false;
    EXCEPTION WHEN others THEN
        guarded := true;
    END;
    ASSERT guarded, 'notifications DELETE must be forbidden by forbid_mutation()';

    ---------------------------------------------------------------------------
    -- snapshot tables: assert both no_update + no_delete guards are installed.
    ---------------------------------------------------------------------------
    -- `prospect_activities` (20260806050000) ikut di sini, bukan sebagai tabel
    -- snapshot: ia log effort sales yang metrik "berapa banyak effort sampai
    -- closing" dihitung darinya, jadi satu baris yang bisa diedit atau dihapus
    -- membuat angka itu tidak lagi bisa direkonstruksi (aturan rumah #3/#4).
    -- `ads_weekly_reports` (20260819020000) juga bukan tabel snapshot: ia laporan
    -- mingguan Advertiser (analisa performa + saran perbaikan) yang menjadi jejak
    -- akuntabilitas minggu itu. Boleh diedit = boleh menulis ulang sejarah setelah
    -- angkanya diketahui, jadi UPDATE/DELETE ditutup dan koreksi ditulis sebagai
    -- laporan minggu berikutnya (aturan rumah #3).
    -- `client_report_insight` (20260908010000) is the narrative half of a client
    -- report, kept append-only for a reason that is easy to miss: it is the ONLY
    -- record of what a client was actually shown. The numbers are already frozen
    -- in `client_reports.payload`, but the sentences the client read are what a
    -- dispute is about ("you told us to scale this"). An editable revision row
    -- would let a published claim be rewritten after the fact, with the published
    -- pin still pointing at it — so UPDATE and DELETE are both closed and a
    -- correction is a NEW revision plus a re-publish (aturan rumah #3).
    FOREACH t IN ARRAY ARRAY['client_health_snapshots', 'performance_snapshots',
                             'prospect_activities', 'ads_weekly_reports',
                             'client_report_insight'] LOOP
        ASSERT (
            SELECT count(*) FROM information_schema.triggers
            WHERE event_object_table = t AND action_statement LIKE '%forbid_mutation%'
        ) = 2, format('%s must carry both no_update and no_delete guards', t);
    END LOOP;

    ---------------------------------------------------------------------------
    -- `client_reports` carries a BESPOKE freeze function (client_reports_frozen)
    -- rather than forbid_mutation, so the loop above cannot see it — and it is
    -- load-bearing beyond its own table: the whole editable-insight design
    -- (20260908010000) exists BECAUSE this trigger blocks every UPDATE, not just
    -- updates to `payload`. If someone ever relaxed it to be column-selective,
    -- the correct move would be to store the edited insight in `payload` and
    -- delete two tables — so the day this assertion fails is the day that design
    -- must be revisited, not the day the assertion gets deleted.
    ---------------------------------------------------------------------------
    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'client_reports'
          AND action_statement LIKE '%client_reports_frozen%'
          AND event_manipulation = 'UPDATE'
    ) = 1, 'client_reports must stay frozen against UPDATE (client_reports_frozen)';

    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'client_report_berkas'
          AND action_statement LIKE '%client_report_berkas_frozen%'
    ) >= 1, 'client_report_berkas must stay frozen (provenance of a frozen report)';

    ---------------------------------------------------------------------------
    -- `client_pitch_consents` (C-5, 2026-09-07) is the ONLY record of the basis
    -- on which a client's real figures were ever allowed into pitch material.
    -- It carries its own freeze function and — unlike `client_reports` — blocks
    -- DELETE as well as UPDATE, because the failure mode here is not a rewritten
    -- number but a vanished one: deleting a `beri` row makes a consent that was
    -- acted upon indistinguishable from one that never existed. Withdrawing a
    -- consent is an INSERT of `aksi = 'cabut'`, never a mutation.
    ---------------------------------------------------------------------------
    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'client_pitch_consents'
          AND action_statement LIKE '%client_pitch_consents_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'client_pitch_consents must stay frozen against UPDATE and DELETE (consent history is the only proof a pitch figure was allowed)';

    ---------------------------------------------------------------------------
    -- Bridge MSDPS→CDPS Fase 1 (20261007010000) — two new frozen tables.
    --
    -- `external_orders.payload` blocks UPDATE only (the row itself is never
    -- deleted — house rule #3 inbox history — but a Fase-2 order revision is a
    -- NEW row with payload_versi+1, never a rewrite of this one).
    ---------------------------------------------------------------------------
    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'external_orders'
          AND action_statement LIKE '%external_orders_payload_frozen%'
          AND event_manipulation = 'UPDATE'
    ) = 1, 'external_orders must stay frozen against UPDATE (external_orders_payload_frozen)';

    -- `client_external_billing` is an attestation that ANOTHER system already
    -- verified a payment — the failure mode is the same as
    -- `client_pitch_consents`, a vanished or silently-edited record of someone
    -- else's verification, so it blocks DELETE as well as UPDATE.
    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'client_external_billing'
          AND action_statement LIKE '%client_external_billing_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'client_external_billing must stay frozen against UPDATE and DELETE (it records someone else''s payment verification, never CDPS''s own)';

    ---------------------------------------------------------------------------
    -- PDT G1-01 — three bespoke-frozen tables (PDT_BACKLOG.md G1-01 DoD:
    -- "tes immutability (pdt_benchmark, pdt_laporan_kiriman tanpa jalur
    -- UPDATE/DELETE)"). `pdt_kolom_alias` added for the same reason: Rule 9
    -- says alias mappings are append-only, and a mapping that silently changed
    -- would make historical column-drift unreadable in exactly the way the
    -- whole PDT-27 whitelist exists to prevent.
    ---------------------------------------------------------------------------
    -- `pdt_benchmark` mirrors `adsscanner_benchmark`/`px_eligibility_policy`
    -- letter-for-letter (PDT_BACKLOG.md G1-01): blocks BOTH UPDATE and DELETE,
    -- `aktif` is never flipped — a new calibration is a new `versi`.
    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'pdt_benchmark'
          AND action_statement LIKE '%pdt_benchmark_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'pdt_benchmark must stay frozen against UPDATE and DELETE (preseden adsscanner_benchmark)';

    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'pdt_kolom_alias'
          AND action_statement LIKE '%pdt_kolom_alias_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'pdt_kolom_alias must stay frozen against UPDATE and DELETE (Rule 9 — alias lama tidak pernah dihapus/diubah)';

    -- `pdt_laporan_kiriman` mirrors `client_reports_frozen`: UPDATE-only (a
    -- revision is a NEW row pointing at `menggantikan_kiriman_id`, Rule 22-23 —
    -- DELETE is not blocked here, same asymmetry as `client_reports`).
    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'pdt_laporan_kiriman'
          AND action_statement LIKE '%pdt_laporan_kiriman_frozen%'
          AND event_manipulation = 'UPDATE'
    ) = 1, 'pdt_laporan_kiriman must stay frozen against UPDATE (preseden client_reports_frozen)';

    -- `pdt_usulan_katalog` is DELIBERATELY NOT frozen (unlike its sibling
    -- `pdt_benchmark`) — G4-01 edits it live via an admin UI, and the PRD never
    -- calls it append-only the way it does for benchmark/kolom_alias/laporan.
    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'pdt_usulan_katalog' AND action_statement LIKE '%frozen%'
    ) = 0, 'pdt_usulan_katalog must NOT be frozen — it is edited live via the G4-01 admin UI, unlike pdt_benchmark';

    ---------------------------------------------------------------------------
    -- Product Exchange M3-B (20261031010000) — three append-only frozen
    -- tables. `px_sku_volume`/`px_sku_kategori` are DELIBERATELY NOT frozen:
    -- volume is UPSERTed per recompute (Flow A) and kategori is a human
    -- correction target (D-24) — history for both lives in px_sku_eligibility.
    ---------------------------------------------------------------------------
    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'px_sku_eligibility'
          AND action_statement LIKE '%px_sku_eligibility_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'px_sku_eligibility must stay frozen against UPDATE and DELETE (verdict baru = baris baru)';

    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'px_coverage_snapshot'
          AND action_statement LIKE '%px_coverage_snapshot_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'px_coverage_snapshot must stay frozen against UPDATE and DELETE (D-20 salinan MCN, append-only)';

    ASSERT (
        SELECT count(DISTINCT event_manipulation) FROM information_schema.triggers
        WHERE event_object_table = 'px_coverage_push'
          AND action_statement LIKE '%px_coverage_push_frozen%'
          AND event_manipulation IN ('UPDATE', 'DELETE')
    ) = 2, 'px_coverage_push must stay frozen against UPDATE and DELETE (kunci idempotensi bridge, satu payload per batch_key)';

    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'px_sku_volume' AND action_statement LIKE '%frozen%'
    ) = 0, 'px_sku_volume must NOT be frozen — UPSERT per recompute (Flow A), unlike px_sku_eligibility';

    ASSERT (
        SELECT count(*) FROM information_schema.triggers
        WHERE event_object_table = 'px_sku_kategori' AND action_statement LIKE '%frozen%'
    ) = 0, 'px_sku_kategori must NOT be frozen — koreksi manusia langsung (D-24), riwayat ada di px_sku_eligibility';
END $$;

---------------------------------------------------------------------------
-- PDT G1-01 — unique partial index bites at the DB level (PDT_BACKLOG.md
-- G1-01 DoD: "tes unique-partial menggigit di DB — batch ditolak boleh
-- diganti, batch verified tidak"). Rule 36: a rejected/superseded batch must
-- never block its replacement, but two VERIFIED batches for the same
-- (toko, periode) is a real conflict.
---------------------------------------------------------------------------
DO $$
DECLARE
    guarded boolean;
BEGIN
    INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                          sales_pic_id, commission_payment_pic_id, created_by)
    VALUES ('ZPDT-IMMUT-0001', 'PIC PDT IMMUT', 'Toko PDT IMMUT', 'Jakarta',
            'https://example.test/pdt-immut', 'Fashion', 0, 0, 'EMP-0001', 'EMP-0001', 'SYSTEM');

    INSERT INTO client_platforms (client_id, platform, active, created_by)
    VALUES ('ZPDT-IMMUT-0001', 'TikTok Shop', true, 'SYSTEM');

    -- Batch 1: `ditolak` — must NOT block a later verified batch for the same period.
    INSERT INTO pdt_upload_batch (client_id, client_platform_id, platform, periode_mulai,
                                   periode_selesai, status, alasan_ditolak, parser_versi,
                                   retensi_sampai, dibuat_oleh)
    SELECT 'ZPDT-IMMUT-0001', cp.id, 'tiktok', '2026-07-01', '2026-07-31', 'ditolak',
           'rekonsiliasi > 0.5% (fixture tes)', 1, '2026-08-30', 'EMP-0002'
      FROM client_platforms cp WHERE cp.client_id = 'ZPDT-IMMUT-0001';

    -- Batch 2: `verified`, SAMA (client_platform_id, periode_mulai, periode_selesai) —
    -- harus BOLEH, karena batch 1 bukan `verified`.
    guarded := false;
    BEGIN
        INSERT INTO pdt_upload_batch (client_id, client_platform_id, platform, periode_mulai,
                                       periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
        SELECT 'ZPDT-IMMUT-0001', cp.id, 'tiktok', '2026-07-01', '2026-07-31', 'verified', 1,
               '2026-11-30', 'EMP-0002'
          FROM client_platforms cp WHERE cp.client_id = 'ZPDT-IMMUT-0001';
        guarded := true; -- reached ⇒ insert benar-benar diterima
    EXCEPTION WHEN unique_violation THEN
        guarded := false;
    END;
    ASSERT guarded, 'pdt_upload_batch: batch ditolak TIDAK BOLEH memblokir batch verified pengganti (Rule 36)';

    -- Batch 3: KEDUA `verified` untuk (toko, periode) yang SAMA — harus DITOLAK.
    guarded := true;
    BEGIN
        INSERT INTO pdt_upload_batch (client_id, client_platform_id, platform, periode_mulai,
                                       periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
        SELECT 'ZPDT-IMMUT-0001', cp.id, 'tiktok', '2026-07-01', '2026-07-31', 'verified', 1,
               '2026-11-30', 'EMP-0002'
          FROM client_platforms cp WHERE cp.client_id = 'ZPDT-IMMUT-0001';
        guarded := false; -- reached hanya bila unique partial GAGAL menggigit
    EXCEPTION WHEN unique_violation THEN
        guarded := true;
    END;
    ASSERT guarded, 'pdt_upload_batch: DUA batch verified untuk (client_platform_id, periode_mulai, periode_selesai) yang sama harus ditolak unique partial';
END $$;

ROLLBACK;

\echo 'immutability_checks: PASS'
