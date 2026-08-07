-- Edit Service before closing — re-approval edges (owner QA revisi 2026-08-07,
-- logged in docs/DECISIONS.md; PRD M0 §5.1).
--
-- WHY THESE EDGES EXIST
--
-- After negotiation the service set the client actually buys is often not the set
-- that was offered at Qualified. The new Edit Service door (domain
-- `sales.reviseServices`) lets the owner revise that set in the window between
-- approval and closing, and appends a new immutable proposal version for it.
--
-- A revision at STANDARD MSL terms moves no status: standard terms are exactly
-- what M0 §5's non-negotiation flow already lets bypass the superior, so
-- re-picking standard services cannot require an approval the original selection
-- did not. That path needs nothing from this migration.
--
-- A revision carrying a CUSTOM price or commission does need the superior again —
-- otherwise a salesperson could rewrite money the superior had already approved,
-- which is the control M0 §5's approval routing exists to enforce. That is what
-- these two edges are: the legal way back to `Negotiation - Pending Approval`
-- from an already-approved attempt. Without them the engine would refuse the
-- transition (correctly), and the only alternative would have been for the TS
-- layer to write the status itself — which the house rules forbid: transitions are
-- written exclusively by sm_transition (CLAUDE.md §Penegakan aturan ada di DB).
--
-- require_lead = false, matching every other salesperson-driven edge into Pending
-- Approval (`Qualified` → Pending, `Revision Required` → Pending, `Rejected` →
-- Pending): it is the SALESPERSON who submits a proposal for approval, and the
-- superior-only edges are the DECISIONS out of Pending Approval (require_lead =
-- true), which are untouched here. Row-scope (own attempt vs division) stays with
-- RLS and `canWriteAttempt`, as on those edges.
--
-- Idempotent: the migration is re-applied by scripts/db-rebuild.sh and by CI's
-- apply-every-migration step, and sm_edges has no unique constraint to lean on.

INSERT INTO sm_edges (machine, from_state, to_state, require_lead)
SELECT v.machine, v.from_state, v.to_state, v.require_lead
FROM (VALUES
    ('prospect_attempt', 'Negotiation - Approved',      'Negotiation - Pending Approval', false),
    ('prospect_attempt', 'Negotiation - Auto Approved', 'Negotiation - Pending Approval', false)
) AS v(machine, from_state, to_state, require_lead)
WHERE NOT EXISTS (
    SELECT 1 FROM sm_edges e
    WHERE e.machine = v.machine AND e.from_state = v.from_state AND e.to_state = v.to_state
);
