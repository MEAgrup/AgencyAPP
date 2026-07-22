-- Port dari backend/migrations/0037_local_auth.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS local authentication (auth interview 2026-07-19, DECISIONS W1-09 precedent):
-- HRIS becomes a data source ONLY (employee sync). Login is now owned by CDPS via
-- a locally stored bcrypt password. Credentials live in their OWN table, never in
-- `employees`, so a full HRIS/CSV re-sync can never touch or reset a password.
--
-- Provisioning is admin-driven: an admin sets a temporary password
-- (must_change_password = 1) and the employee is forced to change it on first
-- login. A brute-force lockout (5 consecutive failures -> locked 15 minutes) is
-- tracked here. No password/hash is ever written to the audit log.
--
-- Migration range: next free after 0036_team_performance. 0001-0036 stay frozen.

CREATE TABLE employee_credentials (
    employee_id          varchar(64)  NOT NULL PRIMARY KEY,
    password_hash        varchar(255) NOT NULL,
    must_change_password boolean      NOT NULL DEFAULT true,
    failed_attempts      integer      NOT NULL DEFAULT 0,
    locked_until         timestamptz  NULL,
    password_changed_at  timestamptz  NULL,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    created_by           varchar(64)  NOT NULL,
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT fk_credentials_employee FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
);

CREATE TRIGGER trg_employee_credentials_updated_at BEFORE UPDATE ON employee_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
