-- CDPS Wave 1 — Module 5 (build stream B). Append-only VERIFICATION EVENT LOG.
--
-- Migration 0002 stores the Transaction/Installment state but has no place to
-- record each individual verification EVENT (amount received, date, proof) that
-- Finance confirms. M5 §7 Rule 1 requires "one proof-of-payment attachment per
-- verification event", and CLAUDE.md conventions #3 (immutable history) / #4
-- (auto-calculated fields recomputable from the log) require Amount Verified /
-- Amount Outstanding and the direct-verified total to be rebuildable from a log,
-- not from a mutable running column. This table is that log.
--
-- One row per verification event. installment_id is NULL for a DIRECT
-- verification (the single Lunas payment, or the upfront Bayar Sebagian partial);
-- it references an INST- row for a per-installment (Termin / Bayar di Belakang)
-- verification. There is deliberately NO UPDATE/DELETE path (append-only).
-- Conventions follow 0002: utf8mb4, InnoDB, created_at/created_by, no cascade.
CREATE TABLE payment_verifications (
    id               BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    transaction_id   VARCHAR(32)   NOT NULL,
    installment_id   VARCHAR(32)   NULL,
    amount           DECIMAL(15,2) NOT NULL,
    received_date    DATE          NOT NULL,
    proof_of_payment VARCHAR(255)  NULL,
    verified_by      VARCHAR(64)   NOT NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by       VARCHAR(64)   NOT NULL,
    KEY idx_payver_trx (transaction_id),
    CONSTRAINT fk_payver_trx FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT fk_payver_inst FOREIGN KEY (installment_id) REFERENCES installments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
