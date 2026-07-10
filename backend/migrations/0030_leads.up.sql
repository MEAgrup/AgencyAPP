-- W1-01 · Lead record central registry (M1 §2, §9.3).
-- The single canonical entry per real lead: one normalized phone = one record
-- (dedup primary key, UNIQUE). The Lead record is DELIBERATELY not modelled by
-- the statemachine engine (see internal/core/statemachine/machines.go: §2 Lead
-- record is excluded as flag/dedup/pool logic owned by M1). record_status is
-- therefore maintained by this module's own dedup/reopen logic, and every
-- change is still appended to the immutable audit log (house convention #3).
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE leads (
  lead_id                   VARCHAR(32)  NOT NULL,               -- LEAD-YYYYMM-NNNN, issued only after validation
  lead_name                 VARCHAR(255) NOT NULL,               -- dedup secondary key
  phone_raw                 VARCHAR(64)  NOT NULL,               -- as entered
  phone_normalized          VARCHAR(64)  NOT NULL,               -- DEDUP PRIMARY KEY (M1 §5 rule 2)
  email                     VARCHAR(255) NULL,                   -- optional; dedup secondary key
  source                    VARCHAR(64)  NOT NULL,               -- reference list; auto-set from campaign on import (M1-OA-3)
  origin_division           VARCHAR(16)  NOT NULL,               -- 'Marketing' | 'Sales'
  origin_campaign           VARCHAR(32)  NULL,                   -- CMP- id; immutable first-touch (M1 §5 Last-Touch note)
  last_touch_campaign       VARCHAR(32)  NULL,                   -- most recent campaign to touch; non-destructive (M1 §5)
  record_status             VARCHAR(32)  NOT NULL,               -- [Pool] / Scouted-Active / [Rejected] / [Not Qualified] / [Closed - Success]
  winning_attempt           VARCHAR(32)  NULL,                   -- PRSP- set at win resolution (W1-03)
  scouted_owner_employee_id VARCHAR(32)  NULL,                   -- denormalized exclusive owner (scouted); dedup block name + M1-OA-5
  manual_review_flag        TINYINT(1)   NOT NULL DEFAULT 0,     -- phone match + name differs substantially (M1-OA-4)
  created_at                DATETIME(6)  NOT NULL,               -- immutable
  updated_at                DATETIME(6)  NOT NULL,
  PRIMARY KEY (lead_id),
  UNIQUE KEY uq_leads_phone_normalized (phone_normalized),
  KEY idx_leads_origin_campaign (origin_campaign),
  KEY idx_leads_record_status (record_status),
  KEY idx_leads_scouted_owner (scouted_owner_employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
