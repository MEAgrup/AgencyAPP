-- CDPS Sprint 0 schema. Conventions: snake_case; created_at + created_by on
-- every table; NO ON DELETE CASCADE for audited entities.

-- Employees: mirror of HRIS people data (HRIS is source of truth). employee_id
-- is the HRIS-issued PK; CDPS never invents it. No password is ever stored.
CREATE TABLE employees (
    employee_id        VARCHAR(64)  NOT NULL PRIMARY KEY,
    nama               VARCHAR(191) NOT NULL,
    email              VARCHAR(191) NOT NULL,
    divisi             VARCHAR(191) NOT NULL,
    jabatan            VARCHAR(191) NOT NULL,
    status_aktif       TINYINT(1)   NOT NULL DEFAULT 1,
    flagged_for_review TINYINT(1)   NOT NULL DEFAULT 0,
    synced_at          DATETIME     NULL,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         VARCHAR(64)  NOT NULL DEFAULT 'SYSTEM',
    UNIQUE KEY uq_employees_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CDPS-owned opaque sessions. Bound to a synced employee. Revocable.
CREATE TABLE sessions (
    token       VARCHAR(128) NOT NULL PRIMARY KEY,
    employee_id VARCHAR(64)  NOT NULL,
    expires_at  DATETIME     NOT NULL,
    revoked_at  DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by  VARCHAR(64)  NOT NULL DEFAULT 'SYSTEM',
    KEY idx_sessions_employee (employee_id),
    CONSTRAINT fk_sessions_employee FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Monthly per-prefix sequence store for PREFIX-YYYYMM-NNNN ID generation.
CREATE TABLE id_sequences (
    prefix     VARCHAR(16) NOT NULL,
    period     CHAR(6)     NOT NULL,
    next_n     INT         NOT NULL DEFAULT 1,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (prefix, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only audit log. Immutability enforced at the storage layer via
-- BEFORE UPDATE / BEFORE DELETE triggers (see below). Every write needs an actor.
CREATE TABLE audit_log (
    id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entity_type       VARCHAR(64)  NOT NULL,
    entity_id         VARCHAR(64)  NOT NULL,
    actor_employee_id VARCHAR(64)  NOT NULL,
    action            VARCHAR(128) NOT NULL,
    before_json       JSON         NULL,
    after_json        JSON         NULL,
    created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by        VARCHAR(64)  NOT NULL,
    KEY idx_audit_entity (entity_type, entity_id),
    KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: UPDATE forbidden';

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: DELETE forbidden';

-- Role mapping: HRIS divisi+jabatan -> CDPS division + level (staff|lead).
CREATE TABLE role_mappings (
    id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    divisi     VARCHAR(191) NOT NULL,
    jabatan    VARCHAR(191) NOT NULL,
    division   VARCHAR(191) NOT NULL,
    level      VARCHAR(16)  NOT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64)  NOT NULL DEFAULT 'SYSTEM',
    UNIQUE KEY uq_role_mapping (divisi, jabatan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Layered OD/Director roles on top of a normal employee account.
CREATE TABLE employee_layered_roles (
    id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    employee_id VARCHAR(64) NOT NULL,
    role        VARCHAR(16) NOT NULL,
    enabled     TINYINT(1)  NOT NULL DEFAULT 1,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by  VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
    UNIQUE KEY uq_layered_role (employee_id, role),
    CONSTRAINT fk_layered_employee FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master Service List: logical service + immutable versions.
CREATE TABLE master_services (
    id         VARCHAR(32) NOT NULL PRIMARY KEY,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE master_service_versions (
    id              BIGINT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
    service_id      VARCHAR(32)    NOT NULL,
    version_no      INT            NOT NULL,
    name            VARCHAR(191)   NOT NULL,
    standard_price  DECIMAL(15,2)  NOT NULL,
    commission_rule VARCHAR(191)   NOT NULL,
    active          TINYINT(1)     NOT NULL DEFAULT 1,
    effective_from  DATE           NOT NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      VARCHAR(64)    NOT NULL,
    UNIQUE KEY uq_service_version (service_id, version_no),
    KEY idx_service_effective (service_id, effective_from),
    CONSTRAINT fk_msv_service FOREIGN KEY (service_id)
        REFERENCES master_services (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- In-app notifications. Mark-as-read only; never deletable (BEFORE DELETE trigger).
CREATE TABLE notifications (
    id                   BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    recipient_employee_id VARCHAR(64) NOT NULL,
    event_type           VARCHAR(64)  NOT NULL,
    entity_type          VARCHAR(64)  NOT NULL,
    entity_id            VARCHAR(64)  NOT NULL,
    actor_employee_id    VARCHAR(64)  NOT NULL,
    deep_link            VARCHAR(255) NOT NULL,
    read_at              DATETIME     NULL,
    created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by           VARCHAR(64)  NOT NULL,
    KEY idx_notif_recipient (recipient_employee_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER notifications_no_delete BEFORE DELETE ON notifications
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notifications are not deletable: DELETE forbidden';

-- Demo task (prefix DEMO-) exercising the canonical brief_task machine.
CREATE TABLE demo_tasks (
    id          VARCHAR(32)  NOT NULL PRIMARY KEY,
    title       VARCHAR(191) NOT NULL,
    description TEXT         NULL,
    division    VARCHAR(191) NOT NULL,
    status      VARCHAR(64)  NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by  VARCHAR(64)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE demo_task_block_requests (
    id          VARCHAR(48)  NOT NULL PRIMARY KEY,
    task_id     VARCHAR(32)  NOT NULL,
    reason      VARCHAR(500) NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'pending',
    requested_by VARCHAR(64) NOT NULL,
    resolved_by VARCHAR(64)  NULL,
    resolved_at DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by  VARCHAR(64)  NOT NULL,
    KEY idx_block_task (task_id),
    CONSTRAINT fk_block_task FOREIGN KEY (task_id)
        REFERENCES demo_tasks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
