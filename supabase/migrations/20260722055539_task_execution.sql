-- Port dari backend/migrations/0024_task_execution.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 2 — Module 12 (Task Execution). The canonical Task Execution engine
-- runs on top of the existing brief_task machine (STATE_MACHINES §7). "Task" is
-- NOT a new entity — it is the role played by an Asset (AST-, M7), a Creator
-- Booking (BKG-, M9), or the Brief itself for single-unit divisions like Ads
-- (DATA_MODEL §1). Today the only Task rows that exist are `briefs`; AST/BKG
-- adopt this same engine when M7/M9 are built. Module 12 adds *computed* fields
-- (turnaround_time, revision_turnaround, speed_score, revision_count) that are
-- DERIVED from the immutable transition history and NEVER stored (house rules
-- 3/4, DATA_MODEL §1 note). Only two persisted additions are needed:
--
--   1. sla_target_hours — the Task-level SLA Target (M12 §2 Rule 10, §5.3). This
--      is DISTINCT from the Brief-level `due_date` (a calendar DATE, the client-
--      facing deadline, M6 §9.4): the Task-level SLA is an internal duration in
--      HOURS, set individually per Task by the target division's Lead/SPV at
--      breakdown, against which Speed Score is measured (Speed Score =
--      turnaround_time ÷ SLA Target, §2 Rule 12). NULLable on purpose: a Task
--      with no SLA Target yields Speed Score = N/A, never silently defaulted or
--      backfilled from the Brief level (§5.3, DATA_MODEL §3 "SLA Target" row).
--
--   2. brief_block_requests — the pending-queue backing §5.3a: Staff/AM may
--      SUBMIT a block request but cannot self-set [Blocked]; only SPV/Lead action
--      it (mirrors the Sprint-0 demo_task_block_requests table). The [Blocked]
--      status itself still lives on `briefs.status` and is written ONLY through
--      the brief_task engine (house rule 2); this table records the request/
--      approval workflow around it.
--
-- Migrations 0002/0010/0020/0021/0022/0023 stay frozen. Wave-2 M6 used 0020–0023;
-- Module 12 owns the 0024–0029 range and extends `briefs` additively (0013/0022
-- precedent) with a default so existing rows/callers keep working.
ALTER TABLE briefs
    ADD COLUMN sla_target_hours numeric(10,2) NULL;

CREATE TABLE brief_block_requests (
    id           varchar(48)  NOT NULL PRIMARY KEY,
    brief_id     varchar(32)  NOT NULL,
    reason       varchar(500) NOT NULL,
    status       varchar(16)  NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    requested_by varchar(64)  NOT NULL,
    resolved_by  varchar(64)  NULL,
    resolved_at  timestamptz  NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL,
    CONSTRAINT fk_brief_block_brief FOREIGN KEY (brief_id) REFERENCES briefs (id)
);

CREATE INDEX idx_brief_block_brief ON brief_block_requests (brief_id);
