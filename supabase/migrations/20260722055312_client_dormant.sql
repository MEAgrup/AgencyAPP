-- Port dari backend/migrations/0013_client_dormant.up.sql (MySQL) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §A

-- CDPS Wave 1 — W1-19 go-live import (build stream B). Dormant client flag.
--
-- O23 (DECISIONS 2026-07-10) brings EVERY ledger client into CDPS: those that
-- are not "active" at go-live land as a client record flagged DORMANT — no
-- TRX/SVC/INST, the deal history summarised in the import provenance audit row —
-- so CRO has a complete database for retention / cross-sell. dormant_at is the
-- timestamp the record was imported as dormant (NULL = a normal, live client).
--
-- Conventions follow 0002/0010-0012: InnoDB/utf8mb4 tables already; this is a
-- pure additive column. ID range for this build stream: 0010-0019
-- (docs/handoff/WAVE1_PARALLEL_PLAN.md §5).
--
-- NOTE on transaction_id / payment_intent: migration 0002 already declares both
-- NULLable (a dormant client carries neither), so NO nullability relaxation is
-- needed here — the dormant insert simply leaves them NULL.
--
-- Catatan port: klausa MySQL `AFTER released_to_account_at` dihapus — Postgres
-- tidak mendukung penempatan kolom, kolom baru selalu ditambahkan di akhir tabel
-- (urutan kolom fisik bukan kontrak semantik apa pun).
ALTER TABLE clients
    ADD COLUMN dormant_at timestamptz NULL;
