-- ============================================================================
-- BACK-PORT (C-03 / DECISIONS O38 opsi A) — verbatim dari project live `CDPS SG`,
-- versi remote `20260724132631_fk_covering_indexes`.
--
-- Migrasi ini sebelumnya HANYA ada di project live (di-apply lewat MCP) dan tak
-- pernah ditulis ke repo, sehingga DB hasil `supabase/migrations/` berbeda dari
-- produksi. C-03 menemukan divergensi itu; O38 memutuskan repo mengikuti live.
-- Isi SQL di bawah tidak diubah sedikit pun — repo harus mereproduksi live
-- persis, bukan versi yang "dirapikan".
-- ============================================================================

-- Covering indexes for three FKs flagged by the performance advisor
-- (lint 0001_unindexed_foreign_keys). Additive, behavior-neutral.
CREATE INDEX IF NOT EXISTS idx_platform_client
  ON client_platforms (client_id);
CREATE INDEX IF NOT EXISTS idx_negline_proposal
  ON negotiation_proposal_lines (proposal_id);
CREATE INDEX IF NOT EXISTS idx_payver_inst
  ON payment_verifications (installment_id);
