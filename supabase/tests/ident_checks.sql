-- Fase-0 DB invariant check: ID generator (plain psql; run with -v ON_ERROR_STOP=1).
--
-- Verifies house rule #1 (PREFIX-YYYYMM-NNNN, gap-free, per WIB period) directly
-- at the Postgres level, mirroring the Go `ident`/`tz` engines and the handoff
-- smoke test. Runs in a transaction and ROLLBACKs so it consumes no real
-- id_sequences rows.
--
-- NOTE: these are plain-SQL assertion scripts (not pgTAP). Fase 0 CI runs them
-- against a stock Postgres container. When Fase 1 introduces RLS/auth and the
-- full local stack (`supabase start`), the immutability/permission suites should
-- graduate to pgTAP via `supabase test db` (Tech Appendix §G).

BEGIN;

DO $$
DECLARE
    -- 2026-07-15T10:00:00Z == 17:00 WIB -> period 202607.
    at_jul timestamptz := '2026-07-15T10:00:00Z';
    -- 2026-06-30T17:30:00Z == 2026-07-01 00:30 WIB -> still rolls into 202607.
    at_roll timestamptz := '2026-06-30T17:30:00Z';
    id1 text;
    id2 text;
    per text;
BEGIN
    per := wib_period(at_jul);
    ASSERT per = '202607', format('wib_period(at_jul) expected 202607, got %s', per);
    ASSERT wib_period(at_roll) = '202607',
        format('wib_period WIB month rollover expected 202607, got %s', wib_period(at_roll));

    -- Gap-free increment within one (prefix, period) bucket.
    id1 := ident_next('TST', at_jul);
    id2 := ident_next('TST', at_jul);
    ASSERT id1 = 'TST-202607-0001', format('first id expected TST-202607-0001, got %s', id1);
    ASSERT id2 = 'TST-202607-0002', format('second id expected TST-202607-0002, got %s', id2);

    -- A different WIB period restarts numbering at 0001.
    ASSERT ident_next('TST', '2026-08-15T10:00:00Z') = 'TST-202608-0001',
        'a new WIB period must restart numbering at 0001';
END $$;

ROLLBACK;

\echo 'ident_checks: PASS'
