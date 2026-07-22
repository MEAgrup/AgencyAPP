-- Port dari backend/migrations/0025_assets.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 2 — Module 7 (Creative), Cluster 1: the Asset (AST-) entity.
--
-- An Asset is Creative's actual unit of work (M7 §2): one row per individual
-- output toward a Brief's Quantity/Target ("12 Product Videos" = up to 12 Asset
-- rows). Each Asset is an independent canonical Task (DATA_MODEL §1: "Task is NOT
-- an entity — it is the role played by AST / BKG / BRF-as-task"), so it runs the
-- SAME brief_task state machine (STATE_MACHINES §7) and gains the SAME Module 12
-- computed fields — turnaround_time / revision_turnaround / speed_score /
-- revision_count — all DERIVED from the immutable transition log, NEVER stored
-- (house rules 3/4). The parent Brief's status becomes a roll-up of its Assets
-- (M7 §2), driven through the engine by Module 12, never a raw UPDATE.
--
-- Migration range: Wave-2 M6/M12 own 0020–0029; M7 takes 0025 within that range
-- (logged in DECISIONS.md — W2-M7-C1).
--
-- Field mapping to M7 §9.3:
--   brief_id                  -> Brief ID (parent, FK). Asset's owning Brief.
--   asset_type                -> Asset Type. Inherited read-only from the Brief's
--                                Deliverable Type at breakdown (Video / Gambar /
--                                Desain / SKU Setup / Copy). Copied on create.
--   sequence_no               -> Sequence # (mandatory). Position within the
--                                Brief's Quantity/Target (e.g. 3 of 12); unique
--                                per Brief.
--   assigned_pic              -> Assigned PIC. Set by Team Leader or self-claimed
--                                (§9.3); NULL until claimed/assigned.
--   output_link               -> Output Link. Mandatory BEFORE [Submitted]
--                                (app-enforced, §4 Rule 3); NULL until submitted.
--   status                    -> Status (brief_task machine, born [To Do]).
--   sla_target_hours          -> Task-level SLA Target (M12 §5.3). Internal hours,
--                                set individually by Team Leader/SPV; NULL => Speed
--                                Score N/A, never backfilled from the Brief.
--   revision_sla_target_hours -> Revision SLA Target (M7-OA-3, §9.3). 24–48h by
--                                Asset Type/complexity, set at breakdown; feeds
--                                revision_speed_score (revision_turnaround ÷ this),
--                                diagnostic only, never blended into Speed Score.
--   hours_logged              -> Hours Logged (M7 §5 Rule 2 / M12 Rule 9). Manual,
--                                self-reported, optional; NEVER folded into KPI
--                                scoring — context only.
--   attributed_gmv            -> Attributed GMV (§8 Rule 3). Written back by Ads/
--                                Reporting (Module 8+); NULL until attributed.
--   (Revision Count / Revision Feedback / Turnaround / Revision Turnaround /
--    Speed Score are DERIVED from the audit log, never columns — house rules 3/4.)
CREATE TABLE assets (
    id                        varchar(32)   NOT NULL PRIMARY KEY,
    brief_id                  varchar(32)   NOT NULL,
    asset_type                varchar(191)  NOT NULL,
    sequence_no               integer       NOT NULL,
    assigned_pic              varchar(64)   NULL,
    output_link               text          NULL,
    status                    varchar(48)   NOT NULL DEFAULT '[To Do]',
    sla_target_hours          numeric(10,2) NULL,
    revision_sla_target_hours numeric(10,2) NULL,
    hours_logged              numeric(10,2) NULL,
    attributed_gmv            numeric(20,2) NULL,
    created_at                timestamptz   NOT NULL DEFAULT now(),
    updated_at                timestamptz   NOT NULL DEFAULT now(),
    created_by                varchar(64)   NOT NULL,
    CONSTRAINT uq_assets_brief_seq UNIQUE (brief_id, sequence_no),
    CONSTRAINT fk_assets_brief FOREIGN KEY (brief_id) REFERENCES briefs (id)
);

CREATE INDEX idx_assets_brief_status ON assets (brief_id, status);
CREATE INDEX idx_assets_pic ON assets (assigned_pic);

CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- asset_block_requests: the §5.3a pending queue for Assets, the exact parallel of
-- brief_block_requests (0024) for the Brief-as-task source. Staff/AM may SUBMIT a
-- block request but cannot self-set [Blocked]; only SPV/Lead action it (§2 Rule 8).
-- The [Blocked] status itself lives on assets.status and is written ONLY through
-- the brief_task engine (house rule 2). ID prefix: ABR- (id_sequences).
CREATE TABLE asset_block_requests (
    id           varchar(48)  NOT NULL PRIMARY KEY,
    asset_id     varchar(32)  NOT NULL,
    reason       varchar(500) NOT NULL,
    status       varchar(16)  NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    requested_by varchar(64)  NOT NULL,
    resolved_by  varchar(64)  NULL,
    resolved_at  timestamptz  NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL,
    CONSTRAINT fk_asset_block_asset FOREIGN KEY (asset_id) REFERENCES assets (id)
);

CREATE INDEX idx_asset_block_asset ON asset_block_requests (asset_id);
