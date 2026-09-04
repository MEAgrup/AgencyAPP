-- CDPS Wave 2 — Module 6 (Account & Service), Cluster 1: Client intake & AM
-- assignment (M6 §3). Adds the CURRENT-AM pointer to the Client Record so the
-- Unassigned Intake Queue (released & assigned_am_id IS NULL) and each AM's
-- personal queue (assigned_am_id = <AM>) are derivable, and M4 §6 Rule 3
-- (Account Staff = assigned clients; Account Lead = all released clients) can
-- finally be enforced — paying off the W1-10 deferral (DECISIONS 2026-07-10).
--
-- Exactly one AM per client at all times (M6-OA-6): a single nullable pointer,
-- never a co-AM table. Assignment / reassignment history (who → whom, when,
-- why) lives in the immutable audit_log, not here — this column only holds the
-- CURRENT owner. Reassignment simply rewrites the pointer (logged, reason
-- mandatory), per §3 Rule 3 and M6-OA-6 (reassignment = the coverage mechanism,
-- no separate backup-AM field).
--
-- Additive & nullable, following the 0013 precedent (dormant_at): migration
-- 0002 stays frozen; Wave 2 M6 owns the 0020–0029 range. NO state column here —
-- assignment is a relationship, not a lifecycle status, so it never moves
-- through the state-machine engine (the per-Service onboarding machine is a
-- later M6 cluster).
ALTER TABLE clients
    ADD COLUMN assigned_am_id VARCHAR(64) NULL AFTER dormant_at,
    ADD KEY idx_clients_assigned_am (assigned_am_id);
