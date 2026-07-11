-- W1-07/08 · Negotiation header (M0 §5), 1:1 with the Prospect attempt.
--
-- One row per attempt that entered Negotiation, created by the FIRST
-- submission on either path (M0 §5 rule 1: on entry the salesperson selects
-- Negotiation Required / No Negotiation Required):
--   negotiation_required = 0 -> W1-07 non-nego path: standard terms only,
--     status `Negotiation - Auto Approved`, approved_version = 1 immediately;
--   negotiation_required = 1 -> W1-08 full flow: versioned proposals routed
--     to the Superior (Sales Head/SPV).
--
-- This header holds the MUTABLE pointers only (current/approved version).
-- The immutable history lives in negotiation_versions /
-- negotiation_version_services / negotiation_decisions (0044-0046,
-- append-only, trigger-enforced). The attempt's negotiation STATUS is NOT
-- here -- it stays on prospect_attempts.status, written exclusively by the
-- statemachine engine (CLAUDE.md convention #2).
--
-- approved_version is set exactly once: at Auto Approve (non-nego), at the
-- Superior's Approve, or at accept-counter ("system syncs values", M0 §5) --
-- W1-09 closing reads the final approved transaction value from this
-- version's rows.
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE negotiations (
  prospect_id          VARCHAR(24)  NOT NULL,           -- PRSP-..., 1:1 with the attempt
  negotiation_required TINYINT(1)   NOT NULL,           -- M0 §5 rule 1 path choice
  current_version      INT UNSIGNED NOT NULL,           -- latest negotiation_versions.version
  approved_version     INT UNSIGNED     NULL,           -- terms W1-09 closing locks onto
  approved_at          DATETIME(6)      NULL,
  approved_by          VARCHAR(64)      NULL,           -- actor of the approving action
  created_at           DATETIME(6)  NOT NULL,
  created_by           VARCHAR(64)  NOT NULL,           -- salesperson who entered negotiation
  PRIMARY KEY (prospect_id),
  CONSTRAINT fk_negotiations_prospect FOREIGN KEY (prospect_id)
    REFERENCES prospect_attempts (prospect_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
