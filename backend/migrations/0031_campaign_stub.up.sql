-- W1-02 · Campaign gate STUB (temporary, to be replaced by the full M3
-- Campaign entity `CMP-` in Wave 3). The real Campaign state machine
-- (docs/STATE_MACHINES.md §3: Draft/Active/Paused/Closed/Archived) is NOT
-- implemented here -- this table exists ONLY so Marketing bulk import (M1 §3
-- rule: parent Campaign must be [Active]) has a gate flag to read, plus the
-- owner needed for the Marketing-Staff own-campaign permission (M1 §9.1) and
-- the source auto-derivation stand-in (M1-OA-3). See DECISIONS.md proposal in
-- the W1-01/W1-02 build report. When M3 lands, migrate these rows into the
-- real campaigns table and drop this stub.
-- Runs on MySQL 8 and MariaDB 10.11.
CREATE TABLE campaign_stub (
  campaign_id       VARCHAR(32)  NOT NULL,            -- CMP-YYYYMM-NNNN (issued by M3 later)
  status            VARCHAR(16)  NOT NULL,            -- gate flag only; 'Active' unlocks import
  source            VARCHAR(64)  NOT NULL,            -- Source auto-applied to leads imported under this campaign (M1-OA-3 stand-in)
  owner_employee_id VARCHAR(32)  NOT NULL,            -- Marketing owner (own-campaign permission, M1 §9.1)
  created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
