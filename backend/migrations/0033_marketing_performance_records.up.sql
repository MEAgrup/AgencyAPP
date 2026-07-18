-- CDPS Wave 3 — Module 2 (Marketing), Cluster 1: the Marketing Performance Record.
--
-- One record per Campaign (CMP-), 1:1 with the acquisition Campaign (M2 §2 / M3-OA-5).
-- The Campaign (0030 campaigns) holds identity + lifecycle + ownership; THIS record
-- holds the only Marketing INPUT that is not on the Campaign: the budget. Everything
-- else Marketing is measured on (Lead-by-Dashboard, Lead-Real-by-Sales, Lead-Quality
-- Rate, Attributed Sales, CPL, CPRL, ROAS, Collected-ROAS, junk breakdown) is DERIVED
-- on read from the Leads DB + Sales/Finance events — never stored (house rule #4). So
-- there is deliberately NO metric column here.
--
-- Online/Offline is NOT duplicated here: it lives ONCE on the Campaign (0030 campaigns
-- is_online/is_offline) and the record reads it via the 1:1 link (WAVE3_PLAN W3-M2-C1
-- decision point — Online/Offline stored once on M3, read by M2). Duplicating it would
-- risk the two drifting apart.
--
-- House rules honoured (CLAUDE.md #1/#3/#4):
--   - campaign_id is the PK, VARCHAR(32) — it IS the Campaign id (M3-OA-5, 1:1). The PK
--     enforces "one record per campaign": a duplicate create hits a unique-key violation
--     and is rejected in the application with a BI message.
--   - budget is DECIMAL(15,2) (IDR), mandatory > 0 — the > 0 guard is enforced in the
--     application (money.Parse + positive check), mirroring the other money inputs that
--     validate in code rather than a CHECK constraint.
--   - the budget is an ordinary field edit (owner-gated), audited before->after in
--     audit_log; there is no status/state machine on this record.
--
-- Migration range: Wave-3 M2 takes 0033 (next free after 0032_campaign_linkage). No hard
-- FK to campaigns is declared (consistent with the linkage columns in 0032, which also
-- avoid a hard campaign FK); the 1:1 integrity is enforced by the application on write
-- (the campaign must exist and be visible before a record is created).

CREATE TABLE marketing_performance_records (
    campaign_id VARCHAR(32)   NOT NULL PRIMARY KEY,   -- CMP-YYYYMM-NNNN, 1:1 (M3-OA-5)
    budget      DECIMAL(15,2) NOT NULL,               -- IDR, > 0 (enforced in application)
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by  VARCHAR(64)   NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
