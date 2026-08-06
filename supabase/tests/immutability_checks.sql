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
    FOREACH t IN ARRAY ARRAY['client_health_snapshots', 'performance_snapshots',
                             'prospect_activities'] LOOP
        ASSERT (
            SELECT count(*) FROM information_schema.triggers
            WHERE event_object_table = t AND action_statement LIKE '%forbid_mutation%'
        ) = 2, format('%s must carry both no_update and no_delete guards', t);
    END LOOP;
END $$;

ROLLBACK;

\echo 'immutability_checks: PASS'
