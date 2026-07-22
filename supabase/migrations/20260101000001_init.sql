-- Port dari backend/migrations/0001_init.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- CDPS Sprint 0 schema. Conventions: snake_case; created_at + created_by on
-- every table; NO ON DELETE CASCADE for audited entities.

-- Employees: mirror of HRIS people data (HRIS is source of truth). employee_id
-- is the HRIS-issued PK; CDPS never invents it. No password is ever stored.
CREATE TABLE employees (
    employee_id        varchar(64)  NOT NULL PRIMARY KEY,
    nama               varchar(191) NOT NULL,
    email              varchar(191) NOT NULL,
    divisi             varchar(191) NOT NULL,
    jabatan            varchar(191) NOT NULL,
    status_aktif       boolean      NOT NULL DEFAULT true,
    flagged_for_review boolean      NOT NULL DEFAULT false,
    synced_at          timestamptz  NULL,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT uq_employees_email UNIQUE (email)
);

-- CDPS-owned opaque sessions. Bound to a synced employee. Revocable.
CREATE TABLE sessions (
    token       varchar(128) NOT NULL PRIMARY KEY,
    employee_id varchar(64)  NOT NULL,
    expires_at  timestamptz  NOT NULL,
    revoked_at  timestamptz  NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT fk_sessions_employee FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id)
);
CREATE INDEX idx_sessions_employee ON sessions (employee_id);

-- Monthly per-prefix sequence store for PREFIX-YYYYMM-NNNN ID generation.
CREATE TABLE id_sequences (
    prefix     varchar(16) NOT NULL,
    period     char(6)     NOT NULL,
    next_n     integer     NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(64) NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (prefix, period)
);

-- Append-only audit log. Immutability enforced at the storage layer via
-- BEFORE UPDATE / BEFORE DELETE triggers (see below). Every write needs an actor.
CREATE TABLE audit_log (
    id                bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type       varchar(64)    NOT NULL,
    entity_id         varchar(64)    NOT NULL,
    actor_employee_id varchar(64)    NOT NULL,
    action            varchar(128)   NOT NULL,
    before_json       jsonb          NULL,
    after_json        jsonb          NULL,
    created_at        timestamptz(3) NOT NULL DEFAULT now(),
    created_by        varchar(64)    NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log (created_at);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Role mapping: HRIS divisi+jabatan -> CDPS division + level (staff|lead).
CREATE TABLE role_mappings (
    id         bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    divisi     varchar(191) NOT NULL,
    jabatan    varchar(191) NOT NULL,
    division   varchar(191) NOT NULL,
    level      varchar(16)  NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    created_by varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT uq_role_mapping UNIQUE (divisi, jabatan)
);

-- Layered OD/Director roles on top of a normal employee account.
CREATE TABLE employee_layered_roles (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id varchar(64) NOT NULL,
    role        varchar(16) NOT NULL,
    enabled     boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  varchar(64) NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT uq_layered_role UNIQUE (employee_id, role),
    CONSTRAINT fk_layered_employee FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id)
);

-- Master Service List: logical service + immutable versions.
CREATE TABLE master_services (
    id         varchar(32) NOT NULL PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(64) NOT NULL
);

CREATE TABLE master_service_versions (
    id              bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id      varchar(32)   NOT NULL,
    version_no      integer       NOT NULL,
    name            varchar(191)  NOT NULL,
    standard_price  numeric(15,2) NOT NULL,
    commission_rule varchar(191)  NOT NULL,
    active          boolean       NOT NULL DEFAULT true,
    effective_from  date          NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    created_by      varchar(64)   NOT NULL,
    CONSTRAINT uq_service_version UNIQUE (service_id, version_no),
    CONSTRAINT fk_msv_service FOREIGN KEY (service_id)
        REFERENCES master_services (id)
);
CREATE INDEX idx_service_effective ON master_service_versions (service_id, effective_from);

-- In-app notifications. Mark-as-read only; never deletable (BEFORE DELETE trigger).
CREATE TABLE notifications (
    id                    bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_employee_id varchar(64)    NOT NULL,
    event_type            varchar(64)    NOT NULL,
    entity_type           varchar(64)    NOT NULL,
    entity_id             varchar(64)    NOT NULL,
    actor_employee_id     varchar(64)    NOT NULL,
    deep_link             varchar(255)   NOT NULL,
    read_at               timestamptz    NULL,
    created_at            timestamptz(3) NOT NULL DEFAULT now(),
    created_by            varchar(64)    NOT NULL
);
CREATE INDEX idx_notif_recipient ON notifications (recipient_employee_id, read_at);

CREATE TRIGGER notifications_no_delete BEFORE DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Demo task (prefix DEMO-) exercising the canonical brief_task machine.
CREATE TABLE demo_tasks (
    id          varchar(32)  NOT NULL PRIMARY KEY,
    title       varchar(191) NOT NULL,
    description text         NULL,
    division    varchar(191) NOT NULL,
    status      varchar(64)  NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL
);

CREATE TABLE demo_task_block_requests (
    id           varchar(48)  NOT NULL PRIMARY KEY,
    task_id      varchar(32)  NOT NULL,
    reason       varchar(500) NOT NULL,
    status       varchar(16)  NOT NULL DEFAULT 'pending',
    requested_by varchar(64)  NOT NULL,
    resolved_by  varchar(64)  NULL,
    resolved_at  timestamptz  NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL,
    CONSTRAINT fk_block_task FOREIGN KEY (task_id)
        REFERENCES demo_tasks (id)
);
CREATE INDEX idx_block_task ON demo_task_block_requests (task_id);
