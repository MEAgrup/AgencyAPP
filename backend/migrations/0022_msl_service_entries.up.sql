-- S0-09 · Master Service List, entry header (Phase 0 §10 / DECISIONS M0 OD-2).
-- name/active here mirror the CURRENT snapshot (latest version) for cheap
-- listing/filtering; the authoritative, versioned truth for every field
-- (including name and active) lives in service_entry_versions (0023) since
-- house convention #3/#4 requires every change to be reconstructable from
-- history, not just the price/commission fields.
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE service_entries (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(255)    NOT NULL,
  active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by VARCHAR(64)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_entries_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
