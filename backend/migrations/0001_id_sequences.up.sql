-- S0-03 · ID generator storage (CLAUDE.md convention #1).
-- One counter row per (prefix, period). period = YYYYMM of the business time.
-- Incremented atomically via INSERT ... ON DUPLICATE KEY UPDATE with
-- LAST_INSERT_ID(seq + 1); the row lock serialises concurrent callers and a
-- caller-transaction rollback restores the counter, so a failed validation
-- never permanently consumes a number.
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE id_sequences (
  prefix     VARCHAR(16)     NOT NULL,
  period     CHAR(6)         NOT NULL,
  seq        BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (prefix, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
