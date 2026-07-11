-- W1-09 · Client Service List -> Service IDs (M0 §6 rule 7, M4 §3/§4
-- M4-OA-5), one row per Approved().Services entry of the winning negotiation.
--
-- The set is immutable at birth (M4-OA-5: "Service List -> Service IDs ...
-- No edit; add/upsell = new Service"), so this table is APPEND-ONLY at the
-- storage layer (BEFORE UPDATE/DELETE triggers, same pattern as 0044-0046):
-- a future upsell ticket adds NEW rows, never edits an existing one; a future
-- Void Service ticket (M4-OA-5 cascade) likewise never rewrites this row --
-- it will be modelled as a new column/flag on a LATER migration if the PRD
-- requires marking a service voided without deleting its row, which the
-- append-only trigger does not block (INSERT is unaffected).
--
-- entry_id / msl_version_id pin the exact Master Service List version the
-- money math used (house convention #4, same pattern as
-- qualified_form_services / negotiation_version_services); final_price /
-- commission_rule / komisi are the winning negotiation's APPROVED terms
-- (Approved().Services), i.e. the "final approved transaction value" basis
-- (M0 §6 rule 6) broken down per service.
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), DECIMAL(18,2), snake_case.
CREATE TABLE client_services (
  service_id         VARCHAR(24)     NOT NULL,              -- SVC-YYYYMM-NNNN
  client_id          VARCHAR(24)     NOT NULL,
  position           INT UNSIGNED    NOT NULL,               -- selection order, 1-based
  entry_id           BIGINT UNSIGNED NOT NULL,               -- MSL service_entries.id
  msl_version_id     BIGINT UNSIGNED NOT NULL,               -- MSL service_entry_versions.id (pinned, approved version)
  msl_version        INT UNSIGNED    NOT NULL,               -- denormalised version number
  service_name       VARCHAR(255)    NOT NULL,               -- snapshot
  final_price        DECIMAL(18,2)   NOT NULL,               -- Approved().Services[i].ProposedPrice
  commission_rule    TEXT            NOT NULL,               -- effective rule komisi was evaluated with
  komisi             DECIMAL(18,2)       NULL,               -- evaluated; NULL while pending
  commission_pending TINYINT(1)      NOT NULL DEFAULT 0,
  created_at         DATETIME(6)     NOT NULL,
  PRIMARY KEY (service_id),
  KEY idx_client_services_client (client_id),
  KEY idx_client_services_entry (entry_id),
  CONSTRAINT fk_client_services_client FOREIGN KEY (client_id)
    REFERENCES clients (client_id),
  CONSTRAINT fk_client_services_entry FOREIGN KEY (entry_id)
    REFERENCES service_entries (id),
  CONSTRAINT fk_client_services_msl_version FOREIGN KEY (msl_version_id)
    REFERENCES service_entry_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER client_services_no_update BEFORE UPDATE ON client_services
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'client_services is append-only: UPDATE forbidden';

CREATE TRIGGER client_services_no_delete BEFORE DELETE ON client_services
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'client_services is append-only: DELETE forbidden';
