-- Port dari backend/migrations/0006_qualified_forms.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- 0006 — Qualified Lead Form persistence (M0 §4, W1-06).
-- The client draft + selected services (with MSL version pinned at submit) live
-- here between qualification and closing. Closing reads these to birth the
-- clients / services rows in the frozen 0002 schema.

CREATE TABLE qualified_forms (
    attempt_id       varchar(32)   NOT NULL PRIMARY KEY,
    lead_id          varchar(32)   NOT NULL,
    nama_pic         varchar(191)  NOT NULL,
    toko             varchar(191)  NOT NULL,
    kota             varchar(191)  NOT NULL,
    link_toko        varchar(255)  NOT NULL,
    kategori         varchar(191)  NOT NULL,
    gmv_baseline     numeric(15,2) NOT NULL,
    target_gmv       numeric(15,2) NOT NULL,
    marketing_budget numeric(15,2) NULL,
    platform         varchar(64)   NOT NULL,
    store_link       varchar(255)  NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    created_by       varchar(64)   NOT NULL,
    CONSTRAINT fk_qf_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
);
CREATE INDEX idx_qf_lead ON qualified_forms (lead_id);

CREATE TABLE qualified_form_services (
    id                bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id        varchar(32)   NOT NULL,
    master_service_id varchar(32)   NOT NULL,
    master_version_no integer       NOT NULL,
    name              varchar(191)  NOT NULL,
    standard_price    numeric(15,2) NOT NULL,
    commission_rule   varchar(191)  NOT NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,
    CONSTRAINT uq_qfs UNIQUE (attempt_id, master_service_id),
    CONSTRAINT fk_qfs_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
);
