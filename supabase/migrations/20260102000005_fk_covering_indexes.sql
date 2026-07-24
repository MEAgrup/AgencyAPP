-- ============================================================================
-- Covering indexes for three foreign keys flagged by the Supabase performance
-- advisor (lint 0001_unindexed_foreign_keys) on CDPS SG.
--
-- Each FK below had no covering index, so a delete/update on the referenced
-- parent row (or a join on the FK) forces a sequential scan of the child table.
-- Additive and behavior-neutral: indexes only, no schema/logic change.
--
--   client_platforms.client_id            (fk_platform_client  -> clients)
--   negotiation_proposal_lines.proposal_id(fk_negline_proposal -> negotiation_proposals)
--   payment_verifications.installment_id  (fk_payver_inst      -> installments)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_platform_client
  ON client_platforms (client_id);

CREATE INDEX IF NOT EXISTS idx_negline_proposal
  ON negotiation_proposal_lines (proposal_id);

CREATE INDEX IF NOT EXISTS idx_payver_inst
  ON payment_verifications (installment_id);
