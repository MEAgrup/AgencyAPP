-- CDPS Wave 3 — Module 11 (PM / Kanban), Cluster 1: the cross-Brief Dependency (DEP-).
--
-- A Dependency (DEP-YYYYMM-NNNN, DATA_MODEL §1) is a formal, AM/SPV-declared link
-- between two Briefs of the SAME Client (M11 §2 Rule 4 / §5.1): a Source Brief that
-- must complete before a Target Brief may finish. Two types (§2 Rule 5):
--   - Blocking      — locks the Target's final transition until the Source reaches
--                     its terminal ([Approved]); enforced as a CODE guard on the
--                     Target's [In Review] -> [Approved] edge (module6/module12), the
--                     same precedent as the Void-Service / ADC-Launch code guards.
--   - Informational — a board marker only; locks nothing.
--
-- House rules honoured (CLAUDE.md #1/#3/#4):
--   - id is DEP-YYYYMM-NNNN, minted (ident.Next) ONLY after create-time validation
--     passes (same Client, no duplicate active pair, no cycle, valid entity types).
--   - The Dependency STATUS (Pending / Blocking / Satisfied, §5.1) is DERIVED on read
--     from the Source Brief's live status — it is NEVER stored (house rule #4). There is
--     deliberately no status column here.
--   - satisfied_notified_at is NOT a status column: it is fire-once notification
--     bookkeeping for EvDependencySatisfied (same precedent as installments'
--     reminder_h3_sent_at, W1-17, and assets' hours_reminder_sent_at, W3-CAT-1). It is
--     written once when the Source first reaches terminal, so the emission never doubles.
--   - Creation is appended to the immutable audit_log (actor, action, after). There is
--     no cancel/delete path in v1 (the PRD defines none) — no UPDATE/DELETE of the row
--     other than the one-shot satisfied_notified_at stamp.
--
-- Entity types: the PRD (§5.1) sanctions ONLY Brief<->Brief dependencies ("Source Brief
-- ID" / "Target Brief ID", both ref BRF). The generic source_type/target_type columns are
-- kept for the requested schema shape and are validated in the application to equal
-- 'brief'; no other entity type is accepted in v1 (documented, DECISIONS W3-M11-C1).
--
-- Same-Client integrity: client_id is a denormalised snapshot of the shared Client of BOTH
-- Briefs, validated at create (both Briefs -> services -> clients must resolve to the same
-- client_id; a mismatch is rejected). It also scopes the Client Board query.
--
-- Migration range: Wave-3 M11 takes 0034 (next free after 0033_marketing_performance_records).
-- No hard FK to briefs is declared (consistent with the campaign linkage columns in 0032 and
-- the performance record in 0033, which also avoid hard cross-module FKs); referential
-- integrity is enforced by the application on write (both Briefs must exist and be visible).

CREATE TABLE dependencies (
    id                    VARCHAR(32)  NOT NULL PRIMARY KEY,   -- DEP-YYYYMM-NNNN
    source_type           VARCHAR(16)  NOT NULL,               -- 'brief' (only sanctioned type, §5.1)
    source_id             VARCHAR(32)  NOT NULL,               -- Source Brief id (BRF-)
    target_type           VARCHAR(16)  NOT NULL,               -- 'brief'
    target_id             VARCHAR(32)  NOT NULL,               -- Target Brief id (BRF-)
    dependency_type       VARCHAR(16)  NOT NULL,               -- 'Blocking' | 'Informational' (§2 Rule 5)
    note                  TEXT         NULL,                   -- free text (esp. Informational, §5.1)
    client_id             VARCHAR(32)  NOT NULL,               -- shared Client of both Briefs (same-Client, §2 Rule 4)
    satisfied_notified_at DATETIME(6)  NULL,                   -- fire-once EvDependencySatisfied bookkeeping (not status)
    created_by            VARCHAR(64)  NOT NULL,               -- AM/SPV who declared it (§6.1)
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- One active Dependency per ordered (Source, Target) pair (§5.1 constraint). With no
    -- cancel path in v1 every row is active, so a plain UNIQUE key enforces it; a duplicate
    -- create hits this key and is reported with a BI message in the application.
    UNIQUE KEY uq_dep_pair (source_type, source_id, target_type, target_id),
    KEY idx_dep_target (target_id),      -- gate lookup: Blocking deps targeting a Brief
    KEY idx_dep_source (source_id),      -- emission lookup: deps whose Source is a Brief
    KEY idx_dep_client (client_id)       -- Client Board scope
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
