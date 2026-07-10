-- S0-04 · Append-only audit log (CLAUDE.md convention #3).
-- Immutable history: there is NO update/delete code path, and mutation is
-- additionally blocked AT THE STORAGE LAYER by BEFORE UPDATE / BEFORE DELETE
-- triggers that SIGNAL SQLSTATE '45000'. All duration metrics derive from
-- these timestamps. No ON DELETE CASCADE — audited rows are never cascaded.
-- Runs on MySQL 8 and MariaDB 10.11.
CREATE TABLE audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(64)     NOT NULL,
  entity_id   VARCHAR(32)     NOT NULL,
  actor       VARCHAR(64)     NOT NULL,
  action      VARCHAR(64)     NOT NULL,
  before_json JSON            NULL,
  after_json  JSON            NULL,
  at          DATETIME(6)     NOT NULL,
  created_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_actor (actor),
  KEY idx_audit_action (action),
  KEY idx_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-statement trigger bodies (no BEGIN/END) so no DELIMITER change is
-- needed and the file runs under multiStatements.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: UPDATE forbidden';

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: DELETE forbidden';
