-- W1-09 · Client Record, birth schema (M0 §6 / M4 §2-3, CLI-YYYYMM-NNNN).
--
-- One row per closed deal, created ONLY at a winning attempt's Closed-Success
-- (internal/module0_sales.Closing.SubmitClosing) -- Module 4's Client Record
-- is born here. Identity/baseline fields are copied LOCKED from the winning
-- attempt's Qualified Lead Form (qualified_forms, 0041) at the moment of
-- closing; per M4 §3 rule 2 the Client Record inherits them already locked --
-- this migration ships the MINIMAL birth columns M0 §6 / M4 §7.3 require.
-- Later phases (Fase 5 M4) add the post-close correction/reassignment paths
-- (Account revising target_gmv/marketing_budget, Account Lead/OD correcting
-- locked fields, Sales Lead reassigning sales_pic/commission_payment_pic) via
-- new migrations/columns -- none of that is implemented by this ticket.
--
-- total_sales is the M4-OA-1/7 "current actual sales" -- auto-updated,
-- read-only, seeded 0.00 at birth (no execution/reporting data exists yet).
-- origin_campaign is nullable (may be empty for a scouted lead, M4 example).
-- winning_prospect_id / lead_id carry NO immutability trigger of their own
-- (the FK to prospect_attempts is enough); lead_id has no FK, mirroring
-- prospect_attempts.lead_id (0040) -- cross-module reference by convention.
--
-- sales_allocations is the M4 §7.3 "Sales Allocation" read-only snapshot of
-- the Closing Form split (M4 lock matrix: "always (read-only snapshot) ...
-- none [editable]") -- APPEND-ONLY at the storage layer (BEFORE UPDATE/DELETE
-- triggers, same SIGNAL '45000' pattern as 0044-0046): allocation corrections
-- are a commission dispute handled by Sales Lead outside field-editing, never
-- a row edit. basis_points is an integer (house convention #4: never a
-- float); the sum across a client's rows MUST equal exactly 10000 -- enforced
-- application-side (SubmitClosing), not by a CHECK constraint (MySQL/MariaDB
-- cannot CHECK across rows).
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), DECIMAL(18,2), snake_case.
CREATE TABLE clients (
  client_id               VARCHAR(24)   NOT NULL,           -- CLI-YYYYMM-NNNN
  nama_pic                VARCHAR(255)  NOT NULL,           -- from Qualified form, locked at Closing (M4 §7.3)
  nama_toko                VARCHAR(255)  NOT NULL,          -- "Toko", locked at Qualified submit
  link_toko               VARCHAR(512)  NOT NULL,           -- locked at Qualified submit
  kategori_bisnis         VARCHAR(255)  NOT NULL,           -- locked at Qualified submit
  kota                    VARCHAR(255)  NOT NULL,           -- locked at Qualified submit
  platform_list           TEXT          NOT NULL,           -- JSON array snapshot, locked at Qualified submit
  gmv_saat_ini            DECIMAL(18,2) NOT NULL,           -- baseline, frozen at Closing (M4-OA-3)
  target_gmv              DECIMAL(18,2) NOT NULL,           -- revisable by Account (future ticket)
  marketing_budget        DECIMAL(18,2)     NULL,           -- optional; revisable by Account (future ticket)
  total_sales             DECIMAL(18,2) NOT NULL DEFAULT 0.00, -- auto, read-only (M4-OA-1/7); seeded 0 at birth
  origin_campaign         VARCHAR(24)       NULL,           -- CMP-... from the won lead; NULL when scouted
  winning_prospect_id     VARCHAR(24)   NOT NULL,           -- PRSP-... the winning attempt
  lead_id                 VARCHAR(24)   NOT NULL,           -- LEAD-..., no FK (mirrors prospect_attempts.lead_id)
  sales_pic               VARCHAR(64)   NOT NULL,           -- = Primary Salesperson (M0 OD-1)
  commission_payment_pic  VARCHAR(64)   NOT NULL,           -- from Closing Form (M0 §6 rule 4); reassignable later
  payment_intent_scheme   VARCHAR(32)   NOT NULL,           -- byte-exact Payment Scheme (M0 §6 rule 5)
  closed_at               DATETIME(6)   NOT NULL,
  closed_by               VARCHAR(64)   NOT NULL,           -- actor who submitted the Closing Form
  created_at              DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (client_id),
  KEY idx_clients_sales_pic (sales_pic),
  KEY idx_clients_commission_pic (commission_payment_pic),
  CONSTRAINT fk_clients_prospect FOREIGN KEY (winning_prospect_id)
    REFERENCES prospect_attempts (prospect_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sales_allocations (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id                 VARCHAR(24)     NOT NULL,
  employee_id               VARCHAR(64)     NOT NULL,
  basis_points              INT UNSIGNED    NOT NULL,       -- Σ per client MUST equal 10000 (app-enforced)
  is_primary                TINYINT(1)      NOT NULL DEFAULT 0,
  is_commission_payment_pic TINYINT(1)      NOT NULL DEFAULT 0,
  created_at                DATETIME(6)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_allocations_client_employee (client_id, employee_id),
  KEY idx_sales_allocations_employee (employee_id),
  CONSTRAINT fk_sales_allocations_client FOREIGN KEY (client_id)
    REFERENCES clients (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER sales_allocations_no_update BEFORE UPDATE ON sales_allocations
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_allocations is append-only: UPDATE forbidden';

CREATE TRIGGER sales_allocations_no_delete BEFORE DELETE ON sales_allocations
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_allocations is append-only: DELETE forbidden';
