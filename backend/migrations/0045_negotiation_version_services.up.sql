-- W1-07/08 · Per-service terms of one negotiation version (M0 §5) --
-- APPEND-ONLY history (same immutability contract as 0044).
--
-- Each row carries BOTH sides the Superior's Negotiation Detail Page shows
-- ("proposed vs. standard values per service, and notes", M0 §5):
--   standard_*  -> the baseline snapshot. For services already on the
--     Qualified Lead Form this is the form's PINNED Master Service List
--     version (qualified_form_services, 0042) -- the negotiation baseline per
--     docs/HANDOFF.md; for additional services picked from the Master
--     Service List it is the version effective at submission time
--     (msl.EffectiveAt, S0-09). msl_version_id pins the exact version either
--     way, so every number is permanently recomputable (house convention #4).
--   proposed_*  -> the terms of THIS version. On the non-nego path
--     ('standard' kind) proposed_price = standard_price and payment_terms is
--     NULL -- standard price / standard commission / full payment only (M0
--     §5 non-nego validation).
--
-- commission_rule is the EFFECTIVE rule this version's komisi was evaluated
-- with: the standard rule re-evaluated against the proposed price, or -- when
-- the proposal negotiates the commission % (M0 §5 rule 2) -- a
-- {"type":"percent","value":<pct>} rule built from the proposed percentage.
-- komisi is NULL (commission_pending = 1) when the effective rule is the
-- seed placeholder {"type":"pending_master_list"} -- never guessed.
--
-- payment_terms NULL = full payment (the standard term); non-NULL = the
-- proposed installment/terms text (M0 §5 rule 2 "payment terms
-- (installments)"). The PRD defines no closed list at negotiation stage --
-- the binding Payment Scheme is chosen on the Closing Form (M0 §6 rule 5).
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE negotiation_version_services (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_version_id   BIGINT UNSIGNED NOT NULL,
  position                 INT UNSIGNED    NOT NULL,     -- selection order, 1-based
  entry_id                 BIGINT UNSIGNED NOT NULL,     -- MSL service_entries.id
  msl_version_id           BIGINT UNSIGNED NOT NULL,     -- MSL service_entry_versions.id (pinned)
  msl_version              INT UNSIGNED    NOT NULL,     -- denormalised version number
  service_name             VARCHAR(255)    NOT NULL,     -- snapshot
  standard_price           DECIMAL(18,2)   NOT NULL,     -- snapshot (baseline)
  standard_commission_rule TEXT            NOT NULL,     -- snapshot of the rule JSON (baseline)
  proposed_price           DECIMAL(18,2)   NOT NULL,     -- this version's price
  commission_rule          TEXT            NOT NULL,     -- effective rule komisi was evaluated with
  komisi                   DECIMAL(18,2)       NULL,     -- auto; NULL while pending
  commission_pending       TINYINT(1)      NOT NULL DEFAULT 0,
  payment_terms            VARCHAR(255)        NULL,     -- NULL = full payment (standard)
  notes                    TEXT                NULL,     -- optional per-service notes (M0 §5)
  PRIMARY KEY (id),
  UNIQUE KEY uq_nvs_version_entry (negotiation_version_id, entry_id), -- a service appears once per version
  KEY idx_nvs_entry (entry_id),
  CONSTRAINT fk_nvs_version FOREIGN KEY (negotiation_version_id)
    REFERENCES negotiation_versions (id),
  CONSTRAINT fk_nvs_entry FOREIGN KEY (entry_id)
    REFERENCES service_entries (id),
  CONSTRAINT fk_nvs_msl_version FOREIGN KEY (msl_version_id)
    REFERENCES service_entry_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER negotiation_version_services_no_update BEFORE UPDATE ON negotiation_version_services
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negotiation_version_services is append-only: UPDATE forbidden';

CREATE TRIGGER negotiation_version_services_no_delete BEFORE DELETE ON negotiation_version_services
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negotiation_version_services is append-only: DELETE forbidden';
