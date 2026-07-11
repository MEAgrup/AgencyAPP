-- W1-06 · Qualified Lead Form, header (M0 §4.3 / M4 §2-3).
--
-- One row per Prospect attempt, created ONLY by a successful
-- SubmitQualifiedForm (M0 §4 rule 1: exit without submit persists nothing,
-- the attempt stays `Contacted`). Because the row is born at submit, it is
-- born locked (M0 §4 rule 4) -- `locked` is stored explicitly so the future
-- M4 correction path (Account Lead / OD, W1-11) has a server-side flag to
-- key on rather than an implicit "row exists" rule.
--
-- estimasi_nilai_transaksi / perhitungan_komisi are auto-computed snapshots
-- (house convention #4): Σ standard prices / Σ commission-rule results of
-- the selected services at the Master Service List version effective on the
-- submit date (msl.EffectiveAt, S0-09). The per-service version reference
-- lives in qualified_form_services (0042) so both numbers are permanently
-- recomputable from the locked MSL versions. perhitungan_komisi is NULL
-- (with commission_pending = 1) when any selected service still carries the
-- seed placeholder rule {"type":"pending_master_list"} -- W1-06 must never
-- guess a commission (docs/HANDOFF.md, Build Plan R3).
--
-- Money columns are DECIMAL(18,2) IDR, never floats (matches 0023).
-- platform_list is a JSON array of the byte-exact M0 §4.3 checklist values
-- (Shopee / TikTok Shop / Tokopedia / Lazada / Others), validated
-- server-side; TEXT keeps MySQL 8 / MariaDB 10.11 compatibility.
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE qualified_forms (
  prospect_id              VARCHAR(24)   NOT NULL,           -- PRSP-..., 1:1 with the attempt
  nama_toko                VARCHAR(255)  NOT NULL,
  nama_pic                 VARCHAR(255)  NOT NULL,           -- Nama (PIC klien), M4 §3
  link_toko                VARCHAR(512)  NOT NULL,
  kategori_bisnis          VARCHAR(255)  NOT NULL,
  kota                     VARCHAR(255)  NOT NULL,
  platform_list            TEXT          NOT NULL,           -- JSON array, closed set §4.3
  gmv_saat_ini             DECIMAL(18,2) NOT NULL,           -- IDR/bln, 3-month average (M4-OA-3)
  target_gmv               DECIMAL(18,2) NOT NULL,           -- IDR/bln
  marketing_budget         DECIMAL(18,2)     NULL,           -- IDR, optional
  estimasi_nilai_transaksi DECIMAL(18,2) NOT NULL,           -- auto, read-only snapshot
  perhitungan_komisi       DECIMAL(18,2)     NULL,           -- auto, read-only; NULL while pending
  commission_pending       TINYINT(1)    NOT NULL DEFAULT 0, -- 1 = >=1 service rule is pending_master_list
  locked                   TINYINT(1)    NOT NULL DEFAULT 1, -- M0 §4 rule 4: locked at submit
  submitted_at             DATETIME(6)   NOT NULL,           -- MSL EffectiveAt anchor
  submitted_by             VARCHAR(64)   NOT NULL,           -- owner salesperson (actor)
  created_at               DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (prospect_id),
  CONSTRAINT fk_qualified_forms_prospect FOREIGN KEY (prospect_id)
    REFERENCES prospect_attempts (prospect_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
