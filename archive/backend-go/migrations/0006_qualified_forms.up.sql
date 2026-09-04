-- 0006 — Qualified Lead Form persistence (M0 §4, W1-06).
-- The client draft + selected services (with MSL version pinned at submit) live
-- here between qualification and closing. Closing reads these to birth the
-- clients / services rows in the frozen 0002 schema.

CREATE TABLE qualified_forms (
    attempt_id       VARCHAR(32)   NOT NULL PRIMARY KEY,
    lead_id          VARCHAR(32)   NOT NULL,
    nama_pic         VARCHAR(191)  NOT NULL,
    toko             VARCHAR(191)  NOT NULL,
    kota             VARCHAR(191)  NOT NULL,
    link_toko        VARCHAR(255)  NOT NULL,
    kategori         VARCHAR(191)  NOT NULL,
    gmv_baseline     DECIMAL(15,2) NOT NULL,
    target_gmv       DECIMAL(15,2) NOT NULL,
    marketing_budget DECIMAL(15,2) NULL,
    platform         VARCHAR(64)   NOT NULL,
    store_link       VARCHAR(255)  NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by       VARCHAR(64)   NOT NULL,
    KEY idx_qf_lead (lead_id),
    CONSTRAINT fk_qf_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE qualified_form_services (
    id                BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attempt_id        VARCHAR(32)   NOT NULL,
    master_service_id VARCHAR(32)   NOT NULL,
    master_version_no INT           NOT NULL,
    name              VARCHAR(191)  NOT NULL,
    standard_price    DECIMAL(15,2) NOT NULL,
    commission_rule   VARCHAR(191)  NOT NULL,
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by        VARCHAR(64)   NOT NULL,
    UNIQUE KEY uq_qfs (attempt_id, master_service_id),
    CONSTRAINT fk_qfs_attempt FOREIGN KEY (attempt_id) REFERENCES prospect_attempts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
