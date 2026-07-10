DROP TABLE IF EXISTS transaction_issue_approvals;

ALTER TABLE transactions
    DROP COLUMN contract_overdue_flagged_at,
    DROP COLUMN bermasalah_flagged_at;

ALTER TABLE installments
    DROP COLUMN reminder_h3_sent_at,
    DROP COLUMN overdue_notified_at;
