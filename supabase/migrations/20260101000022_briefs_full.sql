-- Port dari backend/migrations/0022_briefs_full.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 2 — Module 6 (Account & Service), Cluster 3: Service → Brief
-- breakdown (M6 §5) + Brief dispatch (M6 §6). This migration promotes the W1-12
-- `briefs` STUB (0010 — id/service_id/title/status/created_at/created_by, the
-- minimum the Void-Service cascade needed) into the full Brief entity per the
-- §9.4 field spec. Migration 0002/0010/0020/0021 stay frozen; Wave-2 M6 owns the
-- 0020–0029 range and extends the stub additively (0013 precedent).
--
-- All additions are additive with defaults so the existing stub rows / callers
-- (the Void-cascade inserts in module4 tests use only the stub columns) keep
-- working; the application layer (module6_account.CreateBrief) enforces the real
-- §9.4 mandatory-field validation before minting a BRF- id.
--
-- Field mapping to PRD §9.4:
--   strategy_id            -> Strategy ID (optional; NULL for Direct-path briefs,
--                             §5 Rule 3). For plan-gated services it traces the
--                             brief back to the approved Plan (§5 Rule 2).
--   assigned_division      -> Assigned Division (mandatory; Creative/Ads/KOL/
--                             Live Stream). Live Stream briefs skip the task
--                             machine (§6 Rule 2 / STATE_MACHINES §7) and carry an
--                             off-machine marker status set by the app.
--   assigned_pic           -> Assigned PIC (optional; division lead assigns later).
--   deliverable_type       -> Deliverable Type (mandatory).
--   quantity_target        -> Quantity / Target (mandatory).
--   due_date               -> Due Date (SLA) (mandatory at creation, §9.4). Kept
--                             NULLable at the column level so the M12 "missing SLA
--                             => Speed Score N/A" invariant (DATA_MODEL §3) still
--                             representable; the app requires it on create.
--   priority               -> Priority (mandatory; Low/Medium/High).
--   recurring + sub-fields -> Recurring? toggle and its frequency/count/end date.
--   instructions           -> Instructions / Notes (optional). Also documents a
--                             Direct brief's own justification (§5 Rule 3).
--   reference_attachments  -> Reference Attachments (optional).
--   (title stays the brief name; status stays the lifecycle column; revision
--    count is DERIVED from the audit log, never a stored tally — house rule 3/4.)
ALTER TABLE briefs
    ADD COLUMN strategy_id           varchar(32)  NULL,
    ADD COLUMN assigned_division     varchar(24)  NOT NULL DEFAULT '',
    ADD COLUMN assigned_pic          varchar(64)  NULL,
    ADD COLUMN deliverable_type      varchar(191) NOT NULL DEFAULT '',
    ADD COLUMN quantity_target       integer      NOT NULL DEFAULT 0,
    ADD COLUMN due_date              date         NULL,
    ADD COLUMN priority              varchar(16)  NOT NULL DEFAULT '',
    ADD COLUMN recurring             boolean      NOT NULL DEFAULT false,
    ADD COLUMN recurring_frequency   varchar(48)  NULL,
    ADD COLUMN recurring_count       integer      NULL,
    ADD COLUMN recurring_end_date    date         NULL,
    ADD COLUMN instructions          text         NULL,
    ADD COLUMN reference_attachments text         NULL,
    ADD COLUMN updated_at            timestamptz  NOT NULL DEFAULT now(),
    ADD CONSTRAINT fk_briefs_strategy FOREIGN KEY (strategy_id) REFERENCES strategy_plans (id);

CREATE INDEX idx_briefs_division_status ON briefs (assigned_division, status);
CREATE INDEX idx_briefs_strategy ON briefs (strategy_id);

CREATE TRIGGER trg_briefs_updated_at BEFORE UPDATE ON briefs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
