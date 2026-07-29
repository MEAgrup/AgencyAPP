-- Port dari backend/migrations/0021_strategy_plan.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A
--
-- CDPS Wave 2 — Module 6 (Account & Service), Cluster 2: Strategy & Plan
-- (M6 §2 + §4). This migration owns the 0021 slot in the Wave-2 M6 range
-- (0020–0029); migrations 0002/0020 stay frozen (additive-only precedent, 0013).
--
-- Three additive changes:
--
-- 1) `requires_strategy_plan` on the VERSIONED Master Service List table
--    (master_service_versions). Per M6 §2 the "Requires Strategy Plan" flag is a
--    property of the Service Catalog entry, set when the catalog version is
--    defined (SPV/OD). Because MSL is versioned (every edit = a new immutable
--    version), the flag lives on the version row, not master_services, so it can
--    change across versions like name/price/commission already do. Default 0
--    (Direct path) keeps every pre-existing version Direct — no back-fill.
--
-- 2) `requires_strategy_plan` PINNED onto the Service row (services). M6 §2:
--    "When a Service is created at closing (Module 4), it inherits this flag
--    (read-only)." The Service captures the flag from the pinned MSL version at
--    closing, so later catalog edits never retroactively change an in-flight
--    Service's execution path. Default 0 so legacy importer rows (no MSL linkage,
--    O18) are Direct by default.
--
-- 3) The `strategy_plans` table (STR-) — one Strategy & Plan per plan-gated
--    Service (1:1, enforced by a UNIQUE key on service_id, M6 §4 Rule 1). Status
--    runs the STR- state machine (STATE_MACHINES §6a); it is a normal mutable
--    row (draft edits + engine-driven status), while the immutable transition /
--    revision history lives in audit_log (revision_count is DERIVED from the log,
--    never a stored tally — house rule 3/4). `revision_notes` holds the latest
--    feedback for display; every revision request is also recorded immutably in
--    audit_log.
ALTER TABLE master_service_versions
    ADD COLUMN requires_strategy_plan boolean NOT NULL DEFAULT false;

ALTER TABLE services
    ADD COLUMN requires_strategy_plan boolean NOT NULL DEFAULT false;

CREATE TABLE strategy_plans (
    id                    varchar(32)  NOT NULL PRIMARY KEY,
    service_id            varchar(32)  NOT NULL,
    objective             text         NOT NULL,
    target_kpi            text         NOT NULL,
    divisions_involved    varchar(191) NOT NULL,
    planned_brief_outline text         NOT NULL,
    timeline_start        date         NOT NULL,
    timeline_end          date         NOT NULL,
    status                varchar(48)  NOT NULL,
    approved_by           varchar(64)  NULL,
    revision_notes        text         NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    created_by            varchar(64)  NOT NULL,
    CONSTRAINT uq_strategy_service UNIQUE (service_id),
    CONSTRAINT fk_strategy_service FOREIGN KEY (service_id) REFERENCES services (id)
);

CREATE TRIGGER trg_strategy_plans_updated_at BEFORE UPDATE ON strategy_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
