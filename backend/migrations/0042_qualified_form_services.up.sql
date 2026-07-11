-- W1-06 · Qualified Lead Form, selected services (M0 §4.3 "Jasa Ditawarkan",
-- max 5 -- enforced server-side with the byte-exact message
-- `[maksimal pilih 5 jasa saja!]`).
--
-- Each row snapshots the Master Service List version effective on the
-- submit date (msl.EffectiveAt): version_id/version pin the exact
-- service_entry_versions row the money math used (audit/recompute basis,
-- house convention #4), while service_name/standard_price/commission_rule
-- are denormalised copies so the form renders without a join and stays
-- byte-identical even if someone reads it years later.
--
-- komisi is the evaluated per-service commission; NULL with
-- commission_pending = 1 when the rule is the seed placeholder
-- {"type":"pending_master_list"} (never computed -- docs/HANDOFF.md,
-- Build Plan R3).
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE qualified_form_services (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id        VARCHAR(24)     NOT NULL,
  position           INT UNSIGNED    NOT NULL,               -- selection order, 1-based
  entry_id           BIGINT UNSIGNED NOT NULL,               -- MSL service_entries.id
  version_id         BIGINT UNSIGNED NOT NULL,               -- MSL service_entry_versions.id (locked version)
  version            INT UNSIGNED    NOT NULL,               -- denormalised version number
  service_name       VARCHAR(255)    NOT NULL,               -- snapshot
  standard_price     DECIMAL(18,2)   NOT NULL,               -- snapshot
  commission_rule    TEXT            NOT NULL,               -- snapshot of the rule JSON
  komisi             DECIMAL(18,2)       NULL,               -- evaluated; NULL while pending
  commission_pending TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qfs_prospect_entry (prospect_id, entry_id),  -- a service is selectable once (checkbox set)
  KEY idx_qfs_prospect (prospect_id),
  CONSTRAINT fk_qfs_form FOREIGN KEY (prospect_id)
    REFERENCES qualified_forms (prospect_id),
  CONSTRAINT fk_qfs_entry FOREIGN KEY (entry_id)
    REFERENCES service_entries (id),
  CONSTRAINT fk_qfs_version FOREIGN KEY (version_id)
    REFERENCES service_entry_versions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
