-- W1-09 · Transaction + Installment, birth schema (M0 §6 rule 7-8 /
-- HRIS Module5 Admin Finance §2/§4, TRX-YYYYMM-NNNN / INST-YYYYMM-NNNN).
--
-- A Transaction is born DIRECTLY at `[Menunggu Verifikasi]`
-- (statemachine.TxnMenungguVerifikasi) by INSERT, not by an engine
-- transition -- creation into an initial state is the owning module's job
-- (internal/core/statemachine.Store's GetStatus/SetStatus contract: "the
-- engine only transitions EXISTING rows"), exactly like prospect_attempts is
-- born at `Pending Validation` before its first Engine.Transition call. No
-- Store implementation for statemachine.EntityTransaction/EntityInstallment
-- is wired by this ticket -- that is Module 5's payment-verification ticket;
-- this migration only ships the columns those future transitions will write
-- (payment_status / status), matching the byte-exact labels already reserved
-- in internal/core/statemachine/machines.go so a later Store adapter needs no
-- schema change.
--
-- total_value is the closing salesperson's negotiation-approved value (M0 §6
-- rule 6); amount_verified is seeded 0.00 (Finance's verification ticket, M5,
-- updates it -- read-only here). contract_start_date/contract_duration_months
-- are the Closing Form's Contract Terms (M0 §6 rule 5).
--
-- Installments are born at `[Belum Jatuh Tempo]` (statemachine.InstBelumJatuhTempo)
-- the same way. One row per Termin schedule entry, or exactly one row for
-- `Bayar di Belakang` (due date = the agreed post-paid date); Lunas/Bayar
-- Sebagian create none (HRIS Module5 §4).
--
-- Neither table carries an append-only trigger: unlike sales_allocations /
-- client_services (immutable snapshots), payment_status and installment
-- status are LIVE state-machine columns a future ticket's Store adapter must
-- be able to UPDATE -- exactly like prospect_attempts.status.
--
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), DECIMAL(18,2), snake_case.
CREATE TABLE transactions (
  transaction_id           VARCHAR(24)   NOT NULL,          -- TRX-YYYYMM-NNNN
  client_id                VARCHAR(24)   NOT NULL,
  total_value              DECIMAL(18,2) NOT NULL,          -- final approved transaction value (M0 §6 rule 6)
  payment_intent_scheme    VARCHAR(32)   NOT NULL,          -- byte-exact Payment Scheme
  payment_status           VARCHAR(64)   NOT NULL,          -- statemachine.Status, byte-exact; born [Menunggu Verifikasi]
  amount_verified          DECIMAL(18,2) NOT NULL DEFAULT 0.00, -- auto, read-only; Finance's verification ticket (M5) updates
  contract_start_date      DATETIME(6)   NOT NULL,
  contract_duration_months INT UNSIGNED  NOT NULL,
  last_status_at           DATETIME(6)   NOT NULL,          -- set on every future payment_status transition
  created_at               DATETIME(6)   NOT NULL,
  created_by                VARCHAR(64)   NOT NULL,         -- closing salesperson (actor)
  PRIMARY KEY (transaction_id),
  KEY idx_transactions_client (client_id),
  KEY idx_transactions_status (payment_status),
  CONSTRAINT fk_transactions_client FOREIGN KEY (client_id)
    REFERENCES clients (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE installments (
  installment_id VARCHAR(24)     NOT NULL,                  -- INST-YYYYMM-NNNN
  transaction_id VARCHAR(24)     NOT NULL,
  position       INT UNSIGNED    NOT NULL,                  -- installment # within the schedule, 1-based
  amount         DECIMAL(18,2)   NOT NULL,
  due_date       DATETIME(6)     NOT NULL,
  status         VARCHAR(64)     NOT NULL,                  -- statemachine.Status; born [Belum Jatuh Tempo]
  verified_date  DATETIME(6)         NULL,
  verified_by    VARCHAR(64)         NULL,
  created_at     DATETIME(6)     NOT NULL,
  PRIMARY KEY (installment_id),
  UNIQUE KEY uq_installments_transaction_position (transaction_id, position),
  KEY idx_installments_status (status),
  CONSTRAINT fk_installments_transaction FOREIGN KEY (transaction_id)
    REFERENCES transactions (transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
