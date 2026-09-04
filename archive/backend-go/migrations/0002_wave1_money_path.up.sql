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
    id                     VARCHAR(32)  NOT NULL PRIMARY KEY,
    lead_name              VARCHAR(191) NOT NULL,
    phone_number           VARCHAR(32)  NOT NULL,
    phone_norm             VARCHAR(32)  NOT NULL,
    email                  VARCHAR(191) NULL,
    source                 VARCHAR(64)  NOT NULL,
    origin_division        VARCHAR(32)  NOT NULL,
    origin_campaign_id     VARCHAR(32)  NULL,
    last_touch_campaign_id VARCHAR(32)  NULL,
    record_status          VARCHAR(48)  NOT NULL,
    winning_attempt_id     VARCHAR(32)  NULL,
    manual_review_flag     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by             VARCHAR(64)  NOT NULL,
    KEY idx_leads_phone_norm (phone_norm),
    KEY idx_leads_origin_campaign (origin_campaign_id),
    KEY idx_leads_status (record_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Prospect attempt (PRSP-): one salesperson's run at a LEAD. status driven by
-- the prospect_attempt machine. Multiple attempts per LEAD allowed (Pool).
CREATE TABLE prospect_attempts (
    id                VARCHAR(32) NOT NULL PRIMARY KEY,
    lead_id           VARCHAR(32) NOT NULL,
    owner_employee_id VARCHAR(64) NOT NULL,
    status            VARCHAR(48) NOT NULL,
    claimed_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by        VARCHAR(64) NOT NULL,
    KEY idx_prsp_lead (lead_id),
    KEY idx_prsp_owner (owner_employee_id),
    CONSTRAINT fk_prsp_lead FOREIGN KEY (lead_id) REFERENCES leads (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Not-Qualified reasons (multi-select — DECISIONS O12). One row per selected
-- reason on the attempt that transitioned to Not Qualified.
CREATE TABLE prospect_attempt_nq_reasons (
    id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attempt_id VARCHAR(32) NOT NULL,
    reason     VARCHAR(64) NOT NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64) NOT NULL,
    UNIQUE KEY uq_nq (attempt_id, reason),
    CONSTRAINT fk_nq_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- M0 — Sales: negotiation proposals (versioned, immutable)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE negotiation_proposals (
    id            VARCHAR(32)  NOT NULL PRIMARY KEY,
    attempt_id    VARCHAR(32)  NOT NULL,
    version_no    INT          NOT NULL,
    proposed_by   VARCHAR(64)  NOT NULL,
    decision_note VARCHAR(500) NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(64)  NOT NULL,
    UNIQUE KEY uq_neg_version (attempt_id, version_no),
    CONSTRAINT fk_neg_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE negotiation_proposal_lines (
    id              BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    proposal_id     VARCHAR(32)   NOT NULL,
    master_service_id VARCHAR(32) NOT NULL,
    proposed_price  DECIMAL(15,2) NOT NULL,
    commission_rule VARCHAR(191)  NOT NULL,
    payment_terms   VARCHAR(191)  NULL,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      VARCHAR(64)   NOT NULL,
    CONSTRAINT fk_negline_proposal FOREIGN KEY (proposal_id) REFERENCES negotiation_proposals (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- M4 — Client Record (CLI-) + platforms + sales allocation (read-only snapshot)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE clients (
    id                        VARCHAR(32)   NOT NULL PRIMARY KEY,
    lead_id                   VARCHAR(32)   NULL,
    winning_attempt_id        VARCHAR(32)   NULL,
    nama_pic                  VARCHAR(191)  NOT NULL,
    toko                      VARCHAR(191)  NOT NULL,
    kota                      VARCHAR(191)  NOT NULL,
    link_toko                 VARCHAR(255)  NOT NULL,
    kategori                  VARCHAR(191)  NOT NULL,
    gmv_baseline              DECIMAL(15,2) NOT NULL,
    target_gmv                DECIMAL(15,2) NOT NULL,
    marketing_budget          DECIMAL(15,2) NULL,
    total_sales               DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    origin_campaign_id        VARCHAR(32)   NULL,
    sales_pic_id              VARCHAR(64)   NOT NULL,
    commission_payment_pic_id VARCHAR(64)   NOT NULL,
    transaction_id            VARCHAR(32)   NULL,
    payment_intent            VARCHAR(48)   NULL,
    released_to_account_at    DATETIME      NULL,
    created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by                VARCHAR(64)   NOT NULL,
    KEY idx_clients_sales_pic (sales_pic_id),
    KEY idx_clients_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE client_platforms (
    id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    client_id          VARCHAR(32)  NOT NULL,
    platform           VARCHAR(64)  NOT NULL,
    store_link         VARCHAR(255) NULL,
    managed_since      DATE         NULL,
    active             TINYINT(1)   NOT NULL DEFAULT 1,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         VARCHAR(64)  NOT NULL,
    CONSTRAINT fk_platform_client FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sales Allocation: read-only Σ=100% snapshot (basis points, 100% == 10000).
CREATE TABLE client_sales_allocations (
    id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    client_id     VARCHAR(32) NOT NULL,
    salesperson_id VARCHAR(64) NOT NULL,
    basis_points  INT         NOT NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(64) NOT NULL,
    UNIQUE KEY uq_alloc (client_id, salesperson_id),
    CONSTRAINT fk_alloc_client FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Service (SVC-): one per closed service line. commission_rule/standard_price are
-- the snapshot of the Master Service List version effective at closing.
CREATE TABLE services (
    id                 VARCHAR(32)   NOT NULL PRIMARY KEY,
    client_id          VARCHAR(32)   NOT NULL,
    master_service_id  VARCHAR(32)   NOT NULL,
    master_version_no  INT           NOT NULL,
    name               VARCHAR(191)  NOT NULL,
    standard_price     DECIMAL(15,2) NOT NULL,
    commission_rule    VARCHAR(191)  NOT NULL,
    status             VARCHAR(48)   NOT NULL,
    created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         VARCHAR(64)   NOT NULL,
    KEY idx_services_client (client_id),
    CONSTRAINT fk_service_client FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- M5 — Admin & Finance: transactions (TRX-) + installments (INST-)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE transactions (
    id                    VARCHAR(32)   NOT NULL PRIMARY KEY,
    client_id             VARCHAR(32)   NOT NULL,
    payment_intent_scheme VARCHAR(48)   NOT NULL,
    total_agreed_value    DECIMAL(15,2) NOT NULL,
    payment_status        VARCHAR(48)   NOT NULL,
    bermasalah            TINYINT(1)    NOT NULL DEFAULT 0,
    contract_attachment   VARCHAR(255)  NULL,
    released_to_account_at DATETIME     NULL,
    created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by            VARCHAR(64)   NOT NULL,
    KEY idx_trx_client (client_id),
    CONSTRAINT fk_trx_client FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE installments (
    id               VARCHAR(32)   NOT NULL PRIMARY KEY,
    transaction_id   VARCHAR(32)   NOT NULL,
    installment_no   INT           NOT NULL,
    amount           DECIMAL(15,2) NOT NULL,
    due_date         DATE          NULL,
    status           VARCHAR(48)   NOT NULL,
    jatuh_tempo      TINYINT(1)    NOT NULL DEFAULT 0,
    verified_date    DATE          NULL,
    verified_by      VARCHAR(64)   NULL,
    proof_of_payment VARCHAR(255)  NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by       VARCHAR(64)   NOT NULL,
    UNIQUE KEY uq_inst_no (transaction_id, installment_no),
    CONSTRAINT fk_inst_trx FOREIGN KEY (transaction_id) REFERENCES transactions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
