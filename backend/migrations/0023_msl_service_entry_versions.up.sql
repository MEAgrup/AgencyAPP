-- S0-09 · Master Service List, versions (Phase 0 §10 / DECISIONS M0 OD-2).
-- Every change (price, commission_rule, name, active) inserts a NEW row here
-- -- rows are never updated in place (house convention #3). A closed deal
-- locks onto the version whose effective_from is the latest one <= the
-- closing date (see msl.EffectiveAt); historical commissions never shift
-- when the master list changes later.
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE service_entry_versions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_id        BIGINT UNSIGNED NOT NULL,
  version         INT UNSIGNED    NOT NULL,
  name            VARCHAR(255)    NOT NULL,
  standard_price  DECIMAL(18,2)   NOT NULL,
  commission_rule TEXT            NOT NULL,
  active          TINYINT(1)      NOT NULL,
  effective_from  DATETIME(6)     NOT NULL,
  created_at      DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by      VARCHAR(64)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_entry_versions_entry_version (entry_id, version),
  KEY idx_service_entry_versions_entry_effective (entry_id, effective_from),
  CONSTRAINT fk_service_entry_versions_entry FOREIGN KEY (entry_id)
    REFERENCES service_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
