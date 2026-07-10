-- S0-07 HRIS-delegated auth: CDPS-issued sessions. No FK to employees on
-- purpose (packages stay decoupled); auth joins by employee_id in application
-- code only.
CREATE TABLE sessions (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    token_hash  CHAR(64)    NOT NULL,
    employee_id VARCHAR(32) NOT NULL,
    created_at  DATETIME(6) NOT NULL,
    expires_at  DATETIME(6) NOT NULL,
    revoked_at  DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sessions_token_hash (token_hash),
    KEY idx_sessions_employee_id (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
