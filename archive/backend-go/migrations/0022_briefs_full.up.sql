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
    ADD COLUMN strategy_id           VARCHAR(32)  NULL       AFTER service_id,
    ADD COLUMN assigned_division     VARCHAR(24)  NOT NULL DEFAULT '' AFTER strategy_id,
    ADD COLUMN assigned_pic          VARCHAR(64)  NULL       AFTER assigned_division,
    ADD COLUMN deliverable_type      VARCHAR(191) NOT NULL DEFAULT '' AFTER assigned_pic,
    ADD COLUMN quantity_target       INT          NOT NULL DEFAULT 0  AFTER deliverable_type,
    ADD COLUMN due_date              DATE         NULL       AFTER quantity_target,
    ADD COLUMN priority              VARCHAR(16)  NOT NULL DEFAULT '' AFTER due_date,
    ADD COLUMN recurring             TINYINT(1)   NOT NULL DEFAULT 0  AFTER priority,
    ADD COLUMN recurring_frequency   VARCHAR(48)  NULL       AFTER recurring,
    ADD COLUMN recurring_count       INT          NULL       AFTER recurring_frequency,
    ADD COLUMN recurring_end_date    DATE         NULL       AFTER recurring_count,
    ADD COLUMN instructions          TEXT         NULL       AFTER recurring_end_date,
    ADD COLUMN reference_attachments TEXT         NULL       AFTER instructions,
    ADD COLUMN updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
    ADD KEY idx_briefs_division_status (assigned_division, status),
    ADD KEY idx_briefs_strategy (strategy_id),
    ADD CONSTRAINT fk_briefs_strategy FOREIGN KEY (strategy_id) REFERENCES strategy_plans (id);
