-- Port dari backend/migrations/0036_team_performance.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 3 — Module 14 (Team Performance), Cluster 1: the monthly per-staff
-- Performance Score snapshot (PERF-) plus its admin-configurable KPI Profile
-- weights and period targets.
--
-- A Performance Score (PERF-YYYYMM-NNNN, DATA_MODEL §1/§29) is an AGGREGATION-ONLY
-- record (M14 §2 Rule 1): it introduces NO new raw KPI, only a per-role weighted
-- 0..100 rollup of KPIs that already live in Modules 7/8/9/12 plus the Module 13
-- Client-Outcome Modifier (§2 Rule 3). One snapshot per staff per calendar month
-- (§2 Rule 1 / §5.1), aligned to Module 13's monthly cadence (§5.4).
--
-- House rules honoured (CLAUDE.md #1/#3/#4):
--   - id is PERF-YYYYMM-NNNN, minted (ident.Next) ONLY after the inputs are
--     gathered and the composite is computed; the YYYYMM bucket is the PERIOD
--     month scored (the closed calendar month), not the run month — so
--     PERF-202606-NNNN reads as "June 2026 performance scores" (same convention as
--     CHR- in 0035 / DECISIONS W3-M13-C1).
--   - The snapshot is IMMUTABLE once created (§5.4 "immutable snapshot once
--     created — same convention as Module 13"; STATE_MACHINES §13 "CHR- and PERF-
--     snapshots: created immutable by monthly batch, never transition"). No status
--     column, no state machine. Immutability is enforced at the storage layer by
--     BEFORE UPDATE / BEFORE DELETE triggers, exactly like audit_log (0001) and
--     client_health_snapshots (0035). TRUNCATE (test cleanup) does not fire them.
--   - Every stored sub-score is RECOMPUTABLE from the immutable event/timestamp
--     logs of its source module (house rule 4); the snapshot persists the value
--     computed at close so the trend never shifts under a retroactive recompute.
--     The raw (uncapped) AND capped sub-scores, base + effective (post-
--     redistribution) weights, included/excluded decision + reason per component,
--     and the Client-Outcome Modifier value + source clients all live in
--     components_json so a low score is always explainable (§5.1 / §5.5, mirrors
--     Module 13 §5.6).
--
-- Migration range: Wave-3 M14 takes 0036 (next free after 0035_client_health).
-- Migrations 0001-0035 stay frozen.

CREATE TABLE performance_snapshots (
    id              varchar(32)  NOT NULL PRIMARY KEY,   -- PERF-YYYYMM-NNNN
    staff_id        varchar(64)  NOT NULL,               -- ref employees.employee_id (§5.1)
    role_type       varchar(16)  NOT NULL,               -- 'Creative' | 'Ads' | 'KOL' | 'AM' (determines the KPI Profile, §5.1)
    period_start    date         NOT NULL,               -- first day of the scored calendar month (WIB)
    period_end      date         NOT NULL,               -- last day of the scored calendar month (WIB)
    profile_score   numeric(6,3) NULL,                   -- weighted KPI Profile (Rule 2), post-redistribution; NULL only if all-excluded
    modifier_value  numeric(6,3) NOT NULL DEFAULT 0,     -- Client-Outcome Modifier (Rule 3, clamp ±10); 0 when absent (no CHR source)
    final_score     numeric(6,3) NULL,                   -- profile + modifier, bounded 0..100 (Rule 4); NULL only if all-excluded (renders "—")
    components_json jsonb        NOT NULL,               -- per-component {raw, capped, base_weight, effective_weight, included, diagnostic, excluded_reason} + modifier {value, source_clients, source_component} (§5.1/§5.5)
    computed_at     timestamptz  NOT NULL DEFAULT now(),
    computed_by     varchar(64)  NOT NULL,               -- 'system' (auto, §5.1)
    -- One snapshot per staff per period: the idempotency key of the monthly batch
    -- (§2 Rule 1 / §5.4). A concurrent double-run collides here and is treated as
    -- already-done rather than inserting a duplicate.
    CONSTRAINT uq_perf_staff_period UNIQUE (staff_id, period_start),
    CONSTRAINT fk_perf_staff FOREIGN KEY (staff_id) REFERENCES employees (employee_id)
);

CREATE INDEX idx_perf_staff ON performance_snapshots (staff_id);
CREATE INDEX idx_perf_role_period ON performance_snapshots (role_type, period_start);

-- Immutability at the storage layer (§5.4 / STATE_MACHINES §13): no UPDATE, no
-- DELETE path.
CREATE TRIGGER performance_snapshots_no_update BEFORE UPDATE ON performance_snapshots
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER performance_snapshots_no_delete BEFORE DELETE ON performance_snapshots
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- KPI Profile weights (M14 §5.2 / OA-5): admin-configurable per (role_type,
-- component) so Yohan/HR can retune weights over time WITHOUT a redeploy. The set
-- of components for a role, and their weights, are read from here at compute time;
-- the code validates Σ(weights) == 100 per role_type on every admin write, and the
-- runtime redistribution (Rule 6) re-normalises the AVAILABLE components' weights
-- to 100 again. Weights are NOT a state machine — they are living config, edited
-- through the admin surface and appended to the immutable audit_log (before->after).
CREATE TABLE perf_kpi_weights (
    role_type  varchar(16)  NOT NULL,                   -- 'Creative' | 'Ads' | 'KOL' | 'AM'
    component  varchar(40)  NOT NULL,                    -- component key (see module14_performance component constants)
    weight     numeric(6,3) NOT NULL,                   -- out of 100; Σ per role_type must equal 100 (validated in code)
    updated_at timestamptz  NOT NULL DEFAULT now(),
    updated_by varchar(64)  NOT NULL,
    PRIMARY KEY (role_type, component)
);

CREATE TRIGGER trg_perf_kpi_weights_updated_at BEFORE UPDATE ON perf_kpi_weights
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed = the confirmed §2 Rule 2 weights, VERBATIM (Creative 30/25/25/20;
-- Ads 25/30/25/20; KOL 30/25/20/25; AM 50/25/25). These are the developer default;
-- admin edits supersede them per-row.
INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
    ('Creative', 'speed_score',              30, 'SYSTEM'),
    ('Creative', 'output_quantity',          25, 'SYSTEM'),
    ('Creative', 'gmv_impact',               25, 'SYSTEM'),
    ('Creative', 'revision_count',           20, 'SYSTEM'),
    ('Ads',      'speed_score',              25, 'SYSTEM'),
    ('Ads',      'roas_attainment',          30, 'SYSTEM'),
    ('Ads',      'gmv_impact',               25, 'SYSTEM'),
    ('Ads',      'optimization_activity',    20, 'SYSTEM'),
    ('KOL',      'creator_count',            30, 'SYSTEM'),
    ('KOL',      'qc_pass_rate',             25, 'SYSTEM'),
    ('KOL',      'speed_score',              20, 'SYSTEM'),
    ('KOL',      'escalation_rate',          25, 'SYSTEM'),
    ('AM',       'chr_average',              50, 'SYSTEM'),
    ('AM',       'complaint_resolution_speed', 25, 'SYSTEM'),
    ('AM',       'revision_escalation_rate',  25, 'SYSTEM');

-- Period targets (M14 §2 Rule 2 / OA-2, O9 STILL OPEN): the normalisation basis
-- for the raw-value components (GMV Impact, Output Quantity, Optimization Activity,
-- Creator Count) computed as Actual ÷ Period Target × 100 capped at 100, and the
-- Complaint Resolution Speed SLA target (hours) the AM speed transform uses. Only
-- components that need a target appear here — the self-normalising 0..100 metrics
-- (Speed Score, ROAS Attainment, QC Pass Rate, Escalation Rate, Revision Count,
-- CHR Average, Revision Escalation Rate) carry NO target row.
--
-- O9 (real monthly targets per Advertiser/staff) is NOT yet answered. This table is
-- built configurable so real targets drop in without a redeploy; every SEED row is
-- an explicit PLACEHOLDER (is_placeholder = 1) so no fabricated target is ever
-- mistaken for a confirmed one. period_start = the sentinel default date
-- '0001-01-01' means "applies to every period unless a period-specific row exists";
-- a real per-period target is a row with the actual month's first day, resolved
-- exact-match-first (see module14_performance.loadTargets).
CREATE TABLE perf_period_targets (
    role_type      varchar(16)   NOT NULL,              -- 'Creative' | 'Ads' | 'KOL' | 'AM'
    component      varchar(40)   NOT NULL,              -- raw-value / speed-target component key
    period_start   date          NOT NULL,              -- month first-day; '0001-01-01' = default for all periods
    target_value   numeric(20,4) NOT NULL,              -- normalisation denominator (units per component)
    is_placeholder boolean       NOT NULL DEFAULT true, -- true = illustrative seed, NOT a confirmed target (O9 open)
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    updated_by     varchar(64)   NOT NULL,
    PRIMARY KEY (role_type, component, period_start)
);

CREATE TRIGGER trg_perf_period_targets_updated_at BEFORE UPDATE ON perf_period_targets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- PLACEHOLDER default targets (is_placeholder = 1). Chosen only so the pipeline is
-- exercisable end-to-end; NONE is a confirmed business figure (O9 open). The Kenny
-- §4 worked example passes its OWN targets in-memory in the test, independent of
-- these rows.
INSERT INTO perf_period_targets (role_type, component, period_start, target_value, is_placeholder, updated_by) VALUES
    ('Creative', 'output_quantity',          '0001-01-01', 10,           true, 'SYSTEM'),   -- 10 approved assets / month (placeholder)
    ('Creative', 'gmv_impact',               '0001-01-01', 100000000,    true, 'SYSTEM'),   -- Rp100.000.000 attributed GMV / month (placeholder)
    ('Ads',      'gmv_impact',               '0001-01-01', 100000000,    true, 'SYSTEM'),   -- Rp100.000.000 GMV / month (placeholder)
    ('Ads',      'optimization_activity',    '0001-01-01', 20,           true, 'SYSTEM'),   -- 20 optimizations / month (placeholder)
    ('KOL',      'creator_count',            '0001-01-01', 10,           true, 'SYSTEM'),   -- 10 QC-passed creators / month (placeholder)
    ('AM',       'complaint_resolution_speed','0001-01-01', 48,          true, 'SYSTEM');   -- 48h resolution SLA (placeholder)
