-- Port dari backend/migrations/0012_reminders_bermasalah.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- CDPS Wave 1 — Module 5 (build stream B). Reminder dual-audience fire-once
-- columns (W1-17, M5 §6) + soft 7-day contract flag (W1-18, M5 §7 Rule 3) +
-- [Bermasalah] joint-resolution voting log (W1-18, M5-OA-5). Conventions
-- follow 0002/0011: utf8mb4, InnoDB, created_at/created_by, no cascade.
-- ID range for this build stream: 0010-0019 (docs/handoff/WAVE1_PARALLEL_PLAN.md §5).

-- Fire-once guards for the reminder scan (ScanReminders, module5_finance/reminder.go):
-- reminder_h3_sent_at = H-3 upcoming reminder already sent; overdue_notified_at =
-- the [Jatuh Tempo] notification already sent (distinct from the jatuh_tempo flag
-- itself, which the state machine's parallel column already tracks and clears on
-- verification, M5 §2).
ALTER TABLE installments
    ADD COLUMN reminder_h3_sent_at timestamptz NULL,
    ADD COLUMN overdue_notified_at timestamptz NULL;

-- contract_overdue_flagged_at = the soft 7-day contract expectation (M5 §7 Rule 3
-- / M5-OA-3) fired once, non-blocking. bermasalah_flagged_at = the timestamp of
-- the CURRENT [Bermasalah] cycle (M5-OA-5); votes older than this do not count
-- toward the current resolution (a re-flag after resolution starts a new cycle).
-- Microsecond precision (vs. the plain DATETIME used elsewhere in this file):
-- flag + vote + re-flag can all land in the same wall-clock second (fast
-- automated approval flows), and a 1-second-resolution cycle boundary would
-- wrongly let a previous cycle's vote count toward the next one.
ALTER TABLE transactions
    ADD COLUMN contract_overdue_flagged_at timestamptz    NULL,
    ADD COLUMN bermasalah_flagged_at       timestamptz(6) NULL;

-- [Bermasalah] joint-resolution vote log (M5-OA-5): one append-only row per
-- SPV Finance / SPV Account / Director vote. The latest row per division
-- (created_at >= the transaction's current bermasalah_flagged_at) is that
-- division's current-cycle vote; no UPDATE/DELETE path exists on this table.
-- created_at is microsecond-precision for the same cycle-boundary reason as
-- bermasalah_flagged_at above.
CREATE TABLE transaction_issue_approvals (
    id             bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id varchar(32)    NOT NULL,
    division       varchar(32)    NOT NULL,
    decision       varchar(16)    NOT NULL,
    note           varchar(500)   NULL,
    created_at     timestamptz(6) NOT NULL DEFAULT now(),
    created_by     varchar(64)    NOT NULL,
    CONSTRAINT fk_issueappr_trx FOREIGN KEY (transaction_id) REFERENCES transactions (id)
);
CREATE INDEX idx_issueappr_trx ON transaction_issue_approvals (transaction_id);
