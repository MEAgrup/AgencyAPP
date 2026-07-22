-- Port dari backend/migrations/0035_client_health.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 3 — Module 13 (Client Health Report), Cluster 1: the monthly Client
-- Health Report Snapshot (CHR-) and the per-Client ROAS Inclusion Toggle.
--
-- A Client Health Report Snapshot (CHR-YYYYMM-NNNN, DATA_MODEL §1) is an
-- AGGREGATION-ONLY record (M13 §1): it introduces NO new raw data, only a
-- weighted 0–100 Health Score computed from data that already lives in Modules
-- 4/5/6/8/12. One snapshot per Client per calendar month (M13 §2 Rule 1 / §5.1).
--
-- House rules honoured (CLAUDE.md #1/#3/#4):
--   - id is CHR-YYYYMM-NNNN, minted (ident.Next) ONLY after the snapshot's inputs
--     are gathered and the composite is computed; the YYYYMM bucket is the PERIOD
--     month (the closed calendar month the snapshot scores), not the run month —
--     so CHR-202606-NNNN reads as "June 2026 health reports" (DECISIONS W3-M13-C1).
--   - The snapshot is IMMUTABLE once created (M13 §2 Rule 9 / STATE_MACHINES §13
--     "created immutable by monthly batch, never transition"). There is NO status
--     column and NO state machine here. Immutability is enforced at the storage
--     layer by BEFORE UPDATE / BEFORE DELETE triggers, exactly like audit_log
--     (0001) — the ONLY way a value changes is a brand-new snapshot for a later
--     period. TRUNCATE (test cleanup) does not fire these triggers.
--   - Every stored sub-score is RECOMPUTABLE from the immutable event/timestamp
--     log of its source module (house rule 4); the snapshot persists the value
--     that was computed at close so the historical trend never shifts under a
--     retroactive recompute (Rule 9). The raw (uncapped) AND capped sub-scores,
--     the base + effective (post-redistribution) weights, and the included/
--     excluded decision + reason per component all live in components_json so a
--     low score is always explainable and "why did my score jump" is auditable
--     (§5.1 "both raw and capped", §5.1 "Component Weights Used", §5.6).
--
-- No hard FK to the source-module rows (briefs/installments/ad_campaigns/
-- complaints) is declared — the snapshot is a derived summary, not a child of any
-- one of them; only the Client parent FK is declared (CHR- → CLI, DATA_MODEL §2).
--
-- Migration range: Wave-3 M13 takes 0035 (next free after 0034_dependencies).
-- Migrations 0001–0034 stay frozen.

CREATE TABLE client_health_snapshots (
    id                 varchar(32)  NOT NULL PRIMARY KEY,   -- CHR-YYYYMM-NNNN
    client_id          varchar(32)  NOT NULL,               -- ref CLI (DATA_MODEL §2)
    period_start       date         NOT NULL,               -- first day of the scored calendar month (WIB)
    period_end         date         NOT NULL,               -- last day of the scored calendar month (WIB)
    final_health_score numeric(6,3) NULL,                   -- 0..100 (Rule 7); NULL only if no component was available (defensive, renders "—")
    band               varchar(16)  NOT NULL,               -- 'Healthy' | 'Watch' | 'At Risk' (Rule 7)
    roas_toggle_state  boolean      NOT NULL,               -- effective ROAS-inclusion intent at compute time (Rule 13 / §5.1, for audit)
    components_json    jsonb        NOT NULL,               -- per-component {raw, capped, base_weight, effective_weight, included, excluded_reason} (§5.1/§5.6)
    computed_at        timestamptz  NOT NULL DEFAULT now(),
    computed_by        varchar(64)  NOT NULL,               -- 'system' (auto, §5.1)
    -- One snapshot per Client per period: the idempotency key of the monthly
    -- batch (Rule 1 / §5.2). A concurrent double-run collides here and is treated
    -- as already-done rather than inserting a duplicate.
    CONSTRAINT uq_chr_client_period UNIQUE (client_id, period_start),
    CONSTRAINT fk_chr_client FOREIGN KEY (client_id) REFERENCES clients (id)
);

CREATE INDEX idx_chr_client ON client_health_snapshots (client_id);

-- Immutability at the storage layer (M13 §2 Rule 9): no UPDATE, no DELETE path.
CREATE TRIGGER client_health_snapshots_no_update BEFORE UPDATE ON client_health_snapshots
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER client_health_snapshots_no_delete BEFORE DELETE ON client_health_snapshots
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ROAS Inclusion Toggle (M13 §5.4 / Rule 13): a per-Client override, settable by
-- AM/SPV (+Director per house). Modelled exactly like the M6-OA-1 Strategy-flag
-- override (0029): a SEPARATE nullable column, so the default is DYNAMIC and no
-- back-fill is needed.
--   NULL  = no override -> follow the default (include when the Client has an
--           active Ads service, Rule 13); every existing Client is untouched.
--   0 / 1 = an explicit AM/SPV decision that supersedes the default.
-- A Client with no Ads service AT ALL is still structurally N/A for ROAS
-- regardless of this column (Rule 13) — enforced in code, not here. The change is
-- logged in the immutable audit_log (before→after, actor), not a stored history.
ALTER TABLE clients
    ADD COLUMN roas_health_included_override boolean NULL DEFAULT NULL;
