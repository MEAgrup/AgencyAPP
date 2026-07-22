-- Port dari backend/migrations/0010_briefs_stub.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- CDPS Wave 1 — Module 4 (build stream B). Minimal `briefs` STUB so Void Service
-- (M4-OA-5, W1-12) can cascade-cancel child Briefs before Module 6 is built.
-- Only the columns the void cascade needs exist; Module 6 (Wave 2) owns the full
-- Brief entity and will extend this table via its own migration. Conventions
-- follow 0002: utf8mb4, InnoDB, created_at/created_by, no ON DELETE CASCADE for
-- audited entities. `status` is written ONLY through the brief_task machine.
-- ID prefix: BRF- (id_sequences), minted by Module 6.
CREATE TABLE briefs (
    id         varchar(32)  NOT NULL PRIMARY KEY,
    service_id varchar(32)  NOT NULL,
    title      varchar(191) NOT NULL,
    status     varchar(48)  NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    created_by varchar(64)  NOT NULL,
    CONSTRAINT fk_briefs_service FOREIGN KEY (service_id) REFERENCES services (id)
);
CREATE INDEX idx_briefs_service ON briefs (service_id);
