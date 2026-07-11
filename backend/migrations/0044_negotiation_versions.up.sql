-- W1-08 · Negotiation versions (M0 §5) -- APPEND-ONLY history.
--
-- One row per proposal iteration on an attempt's negotiation:
--   kind = 'standard' -> the single version of the non-nego path (W1-07):
--     standard terms snapshot, born approved;
--   kind = 'proposal' -> a salesperson submission (initial or resubmit after
--     `Revision Required` -- "new version", M0 §5);
--   kind = 'counter'  -> the Superior's Revise/Counter Offer (revised terms,
--     M0 §5 approval flow).
--
-- Version history is IMMUTABLE (M0 §7.2 "History immutable, incl.
-- negotiation versions"; W1-08 AC) -- like audit_log/notifications this is
-- enforced AT THE STORAGE LAYER by BEFORE UPDATE/DELETE triggers that
-- SIGNAL SQLSTATE '45000'. There is no UPDATE/DELETE code path either.
--
-- total_value / total_komisi are auto-computed snapshots (house convention
-- #4): Σ proposed prices / Σ commission evaluated per service by the SAME
-- EvaluateCommissionRule used on the Qualified form, against the PROPOSED
-- prices. total_komisi is NULL (commission_pending = 1) while any service's
-- effective rule is the seed placeholder {"type":"pending_master_list"} --
-- never guessed (Build Plan R3).
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE negotiation_versions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id        VARCHAR(24)     NOT NULL,
  version            INT UNSIGNED    NOT NULL,           -- 1-based, dense
  kind               VARCHAR(16)     NOT NULL,           -- standard | proposal | counter
  proposed_by        VARCHAR(64)     NOT NULL,           -- salesperson, or Superior for counter
  total_value        DECIMAL(18,2)   NOT NULL,           -- auto: Σ proposed prices
  total_komisi       DECIMAL(18,2)       NULL,           -- auto: Σ komisi; NULL while pending
  commission_pending TINYINT(1)      NOT NULL DEFAULT 0,
  submitted_at       DATETIME(6)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_negotiation_versions (prospect_id, version),
  CONSTRAINT fk_nv_negotiation FOREIGN KEY (prospect_id)
    REFERENCES negotiations (prospect_id),
  CONSTRAINT chk_nv_kind CHECK (kind IN ('standard', 'proposal', 'counter'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-statement trigger bodies (no BEGIN/END) so no DELIMITER change is
-- needed and the file runs under multiStatements (same pattern as 0002).
CREATE TRIGGER negotiation_versions_no_update BEFORE UPDATE ON negotiation_versions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negotiation_versions is append-only: UPDATE forbidden';

CREATE TRIGGER negotiation_versions_no_delete BEFORE DELETE ON negotiation_versions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negotiation_versions is append-only: DELETE forbidden';
