-- Port dari backend/migrations/0002_wave1_money_path.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- CDPS Wave 1 (money path) schema — SHARED FOUNDATION.
-- Owns every entity the M0/M1/M4/M5 tickets build on, so the two parallel build
-- streams never invent colliding tables. Conventions (as Sprint 0): snake_case;
-- created_at + created_by on every table; no ON DELETE CASCADE for audited
-- entities. Status columns are written ONLY through the state-machine engine.
-- ID prefixes (id_sequences): LEAD, PRSP, NEG, CLI, SVC, TRX, INST.

-- ─────────────────────────────────────────────────────────────────────────────
-- M1 — Leads Database
-- ─────────────────────────────────────────────────────────────────────────────

-- Lead record (LEAD-): central registry. record_status is driven by the
-- lead_record machine. phone_norm holds the normalized phone (dedup primary key).
CREATE TABLE leads (
    id                     varchar(32)  NOT NULL PRIMARY KEY,
    lead_name              varchar(191) NOT NULL,
    phone_number           varchar(32)  NOT NULL,
    phone_norm             varchar(32)  NOT NULL,
    email                  varchar(191) NULL,
    source                 varchar(64)  NOT NULL,
    origin_division        varchar(32)  NOT NULL,
    origin_campaign_id     varchar(32)  NULL,
    last_touch_campaign_id varchar(32)  NULL,
    record_status          varchar(48)  NOT NULL,
    winning_attempt_id     varchar(32)  NULL,
    manual_review_flag     boolean      NOT NULL DEFAULT false,
    created_at             timestamptz  NOT NULL DEFAULT now(),
    created_by             varchar(64)  NOT NULL
);
CREATE INDEX idx_leads_phone_norm ON leads (phone_norm);
CREATE INDEX idx_leads_origin_campaign ON leads (origin_campaign_id);
CREATE INDEX idx_leads_status ON leads (record_status);

-- Prospect attempt (PRSP-): one salesperson's run at a LEAD. status driven by
-- the prospect_attempt machine. Multiple attempts per LEAD allowed (Pool).
CREATE TABLE prospect_attempts (
    id                varchar(32) NOT NULL PRIMARY KEY,
    lead_id           varchar(32) NOT NULL,
    owner_employee_id varchar(64) NOT NULL,
    status            varchar(48) NOT NULL,
    claimed_at        timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        varchar(64) NOT NULL,
    CONSTRAINT fk_prsp_lead FOREIGN KEY (lead_id) REFERENCES leads (id)
);
CREATE INDEX idx_prsp_lead ON prospect_attempts (lead_id);
CREATE INDEX idx_prsp_owner ON prospect_attempts (owner_employee_id);

-- Not-Qualified reasons (multi-select — DECISIONS O12). One row per selected
-- reason on the attempt that transitioned to Not Qualified.
CREATE TABLE prospect_attempt_nq_reasons (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id varchar(32) NOT NULL,
    reason     varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(64) NOT NULL,
    CONSTRAINT uq_nq UNIQUE (attempt_id, reason),
    CONSTRAINT fk_nq_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- M0 — Sales: negotiation proposals (versioned, immutable)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE negotiation_proposals (
    id            varchar(32)  NOT NULL PRIMARY KEY,
    attempt_id    varchar(32)  NOT NULL,
    version_no    integer      NOT NULL,
    proposed_by   varchar(64)  NOT NULL,
    decision_note varchar(500) NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,
    CONSTRAINT uq_neg_version UNIQUE (attempt_id, version_no),
    CONSTRAINT fk_neg_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
);

CREATE TABLE negotiation_proposal_lines (
    id                bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proposal_id       varchar(32)   NOT NULL,
    master_service_id varchar(32)   NOT NULL,
    proposed_price    numeric(15,2) NOT NULL,
    commission_rule   varchar(191)  NOT NULL,
    payment_terms     varchar(191)  NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,
    CONSTRAINT fk_negline_proposal FOREIGN KEY (proposal_id) REFERENCES negotiation_proposals (id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- M4 — Client Record (CLI-) + platforms + sales allocation (read-only snapshot)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE clients (
    id                        varchar(32)   NOT NULL PRIMARY KEY,
    lead_id                   varchar(32)   NULL,
    winning_attempt_id        varchar(32)   NULL,
    nama_pic                  varchar(191)  NOT NULL,
    toko                      varchar(191)  NOT NULL,
    kota                      varchar(191)  NOT NULL,
    link_toko                 varchar(255)  NOT NULL,
    kategori                  varchar(191)  NOT NULL,
    gmv_baseline              numeric(15,2) NOT NULL,
    target_gmv                numeric(15,2) NOT NULL,
    marketing_budget          numeric(15,2) NULL,
    total_sales               numeric(15,2) NOT NULL DEFAULT 0.00,
    origin_campaign_id        varchar(32)   NULL,
    sales_pic_id              varchar(64)   NOT NULL,
    commission_payment_pic_id varchar(64)   NOT NULL,
    transaction_id            varchar(32)   NULL,
    payment_intent            varchar(48)   NULL,
    released_to_account_at    timestamptz   NULL,
    created_at                timestamptz   NOT NULL DEFAULT now(),
    created_by                varchar(64)   NOT NULL
);
CREATE INDEX idx_clients_sales_pic ON clients (sales_pic_id);
CREATE INDEX idx_clients_lead ON clients (lead_id);

CREATE TABLE client_platforms (
    id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id     varchar(32)  NOT NULL,
    platform      varchar(64)  NOT NULL,
    store_link    varchar(255) NULL,
    managed_since date         NULL,
    active        boolean      NOT NULL DEFAULT true,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,
    CONSTRAINT fk_platform_client FOREIGN KEY (client_id) REFERENCES clients (id)
);

-- Sales Allocation: read-only Σ=100% snapshot (basis points, 100% == 10000).
CREATE TABLE client_sales_allocations (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id      varchar(32) NOT NULL,
    salesperson_id varchar(64) NOT NULL,
    basis_points   integer     NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     varchar(64) NOT NULL,
    CONSTRAINT uq_alloc UNIQUE (client_id, salesperson_id),
    CONSTRAINT fk_alloc_client FOREIGN KEY (client_id) REFERENCES clients (id)
);

-- Service (SVC-): one per closed service line. commission_rule/standard_price are
-- the snapshot of the Master Service List version effective at closing.
CREATE TABLE services (
    id                varchar(32)   NOT NULL PRIMARY KEY,
    client_id         varchar(32)   NOT NULL,
    master_service_id varchar(32)   NOT NULL,
    master_version_no integer       NOT NULL,
    name              varchar(191)  NOT NULL,
    standard_price    numeric(15,2) NOT NULL,
    commission_rule   varchar(191)  NOT NULL,
    status            varchar(48)   NOT NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,
    CONSTRAINT fk_service_client FOREIGN KEY (client_id) REFERENCES clients (id)
);
CREATE INDEX idx_services_client ON services (client_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- M5 — Admin & Finance: transactions (TRX-) + installments (INST-)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE transactions (
    id                     varchar(32)   NOT NULL PRIMARY KEY,
    client_id              varchar(32)   NOT NULL,
    payment_intent_scheme  varchar(48)   NOT NULL,
    total_agreed_value     numeric(15,2) NOT NULL,
    payment_status         varchar(48)   NOT NULL,
    bermasalah             boolean       NOT NULL DEFAULT false,
    contract_attachment    varchar(255)  NULL,
    released_to_account_at timestamptz   NULL,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    created_by             varchar(64)   NOT NULL,
    CONSTRAINT fk_trx_client FOREIGN KEY (client_id) REFERENCES clients (id)
);
CREATE INDEX idx_trx_client ON transactions (client_id);

CREATE TABLE installments (
    id               varchar(32)   NOT NULL PRIMARY KEY,
    transaction_id   varchar(32)   NOT NULL,
    installment_no   integer       NOT NULL,
    amount           numeric(15,2) NOT NULL,
    due_date         date          NULL,
    status           varchar(48)   NOT NULL,
    jatuh_tempo      boolean       NOT NULL DEFAULT false,
    verified_date    date          NULL,
    verified_by      varchar(64)   NULL,
    proof_of_payment varchar(255)  NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    created_by       varchar(64)   NOT NULL,
    CONSTRAINT uq_inst_no UNIQUE (transaction_id, installment_no),
    CONSTRAINT fk_inst_trx FOREIGN KEY (transaction_id) REFERENCES transactions (id)
);
