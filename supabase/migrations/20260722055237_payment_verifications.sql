-- Port dari backend/migrations/0011_payment_verifications.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

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
    id               bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id   varchar(32)   NOT NULL,
    installment_id   varchar(32)   NULL,
    amount           numeric(15,2) NOT NULL,
    received_date    date          NOT NULL,
    proof_of_payment varchar(255)  NULL,
    verified_by      varchar(64)   NOT NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    created_by       varchar(64)   NOT NULL,
    CONSTRAINT fk_payver_trx FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT fk_payver_inst FOREIGN KEY (installment_id) REFERENCES installments (id)
);
CREATE INDEX idx_payver_trx ON payment_verifications (transaction_id);
