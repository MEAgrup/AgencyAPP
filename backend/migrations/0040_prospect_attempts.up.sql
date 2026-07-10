-- W1-05 · Prospect attempt (M0 §2-4 / M1 §9.3, PRSP-YYYYMM-NNNN).
--
-- This is the entity the statemachine engine's §1 "Prospect attempt" machine
-- transitions (internal/module0_sales.prospectStatusStore reads/writes the
-- `status` column here; no other code path may write it -- CLAUDE.md
-- convention #2). One row = one salesperson's working copy of a Module 1
-- Lead record.
--
-- lead_id deliberately carries NO foreign key: module1_leads (the owner of
-- the `LEAD-...` registry) is being built in parallel in this same wave, so
-- the LEAD-... table may not exist yet at migration time, and the two
-- modules' migration ranges must stay independent. Referential validation
-- (does lead_id really exist / is it still open for a new attempt) is an
-- application-level check to be wired when module1_leads lands -- see
-- DECISIONS.md proposal in the W1-05 ticket report.
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE prospect_attempts (
  prospect_id          VARCHAR(24)  NOT NULL,               -- PRSP-YYYYMM-NNNN
  lead_id              VARCHAR(24)  NOT NULL,                -- parent LEAD-..., no FK (see above)
  owner_employee_id    VARCHAR(64)  NOT NULL,                -- salesperson who owns this attempt
  status               VARCHAR(64)  NOT NULL,                -- statemachine.Status, byte-exact
  not_qualified_reason VARCHAR(255)     NULL,                -- taxonomy enforcement is W1-04, not this ticket
  contact_action_type  VARCHAR(32)      NULL,                -- real action recorded at New Lead -> Contacted (M0 §4 rule 1): call/chat/meeting/visit
  last_status_at       DATETIME(6)  NOT NULL,                 -- set on every transition
  created_at           DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by           VARCHAR(64)  NOT NULL,                 -- registering/claiming salesperson
  PRIMARY KEY (prospect_id),
  KEY idx_prospect_attempts_lead (lead_id),
  KEY idx_prospect_attempts_owner (owner_employee_id),
  KEY idx_prospect_attempts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
