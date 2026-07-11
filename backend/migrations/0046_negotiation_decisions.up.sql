-- W1-08 · Superior/salesperson decisions on negotiation versions (M0 §5
-- approval flow) -- APPEND-ONLY history (same immutability contract as 0044).
--
-- One row per decision taken on a version, so the full negotiation history
-- (who decided what, when, with which notes) is reconstructable without ever
-- mutating a version row:
--   action = 'approved' -> Superior Approve  -> `Negotiation - Approved`
--   action = 'counter'  -> Superior Revise / Counter Offer (mandatory notes)
--                          -> `Negotiation - Revision Required`; the revised
--                          terms are the NEW 'counter' version created in the
--                          same transaction
--   action = 'rejected' -> Superior Reject (mandatory notes)
--                          -> `Negotiation - Rejected`
--   action = 'accepted' -> counter-offer accepted ("system syncs values")
--                          -> `Negotiation - Approved` (see DECISIONS.md O18
--                          for who may accept)
--
-- notes is enforced mandatory at the app layer for 'counter' and 'rejected'
-- (M0 §5: "mandatory notes"); optional otherwise.
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE negotiation_decisions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id VARCHAR(24)     NOT NULL,
  version     INT UNSIGNED    NOT NULL,                  -- the version this decision responds to
  action      VARCHAR(16)     NOT NULL,                  -- approved | counter | rejected | accepted
  notes       TEXT                NULL,
  decided_by  VARCHAR(64)     NOT NULL,
  decided_at  DATETIME(6)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_nd_prospect (prospect_id),
  CONSTRAINT fk_nd_negotiation FOREIGN KEY (prospect_id)
    REFERENCES negotiations (prospect_id),
  CONSTRAINT chk_nd_action CHECK (action IN ('approved', 'counter', 'rejected', 'accepted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER negotiation_decisions_no_update BEFORE UPDATE ON negotiation_decisions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negotiation_decisions is append-only: UPDATE forbidden';

CREATE TRIGGER negotiation_decisions_no_delete BEFORE DELETE ON negotiation_decisions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negotiation_decisions is append-only: DELETE forbidden';
