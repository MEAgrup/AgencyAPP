-- S0-08 · Role-mapping table (CLAUDE.md convention #6 / Phase 0 §4, §8).
-- HRIS (divisi, jabatan) -> CDPS base role. Read on every permission
-- resolution (internal/core/authz.Resolver) so a mapping change takes effect
-- without redeploy. Base roles only (staff / lead_spv); OD/Director are
-- layered via role_overrides (0021), never rows here.
-- No FK to the employees table (owned by another agent/migration range);
-- employee identifiers are looked up by string id elsewhere.
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE role_mappings (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  divisi     VARCHAR(100)    NOT NULL,
  jabatan    VARCHAR(100)    NOT NULL,
  role       VARCHAR(20)     NOT NULL,
  created_at DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by VARCHAR(64)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_mappings_divisi_jabatan (divisi, jabatan),
  CONSTRAINT chk_role_mappings_role CHECK (role IN ('staff', 'lead_spv'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
