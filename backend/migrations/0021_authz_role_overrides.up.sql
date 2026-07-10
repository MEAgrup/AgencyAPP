-- S0-08 · Layered role overrides (CLAUDE.md convention #6 / Phase 0 §4).
-- OD and Director are additional roles layered on one employee account on
-- top of whatever role_mappings (0020) resolves for their (divisi, jabatan)
-- -- never a replacement for the base row. An employee_id may hold both
-- 'od' and 'director' rows, or neither.
-- No FK to the employees table (owned by another agent/migration range).
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE role_overrides (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id VARCHAR(32)     NOT NULL,
  role        VARCHAR(20)     NOT NULL,
  created_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by  VARCHAR(64)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_overrides_employee_role (employee_id, role),
  CONSTRAINT chk_role_overrides_role CHECK (role IN ('od', 'director'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
