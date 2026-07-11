package leads

// W1-04 -- Bad-lead (junk) evaluation, M1 §8 rule 6 + M1-OA-7/M1-OA-8.
//
// A lead is treated as JUNK for source evaluation when either:
//   - ALL of its Prospect attempts terminated `Not Qualified` (it has at
//     least one attempt and none in any other status), or
//   - it is an unclaimed `[Pool]` record (zero attempts) aged past the
//     24h stale TTL (M1-OA-7, computed via the existing IsStale helper --
//     the flag is never stored).
//
// The aggregation exposes junk count + Not-Qualified reason breakdown by
// source and by origin campaign (M1 §8 example: `[Bukan seller]`: 11,
// `[Tidak ada respon]`: 5, ...), consumed by Marketing (Module 2) and OD.
// All counters are system-computed and read-only (house convention #4):
// nothing here is ever stored -- every call recomputes from leads +
// prospect_attempts.

import (
	"context"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// JunkLead is one junk lead in the evaluation, with the attribution fields
// the breakdown groups on.
type JunkLead struct {
	LeadID         string
	Source         string
	OriginCampaign string // "" when the lead has no origin campaign (e.g. scouted)
	// NotQualifiedReason is the M1-OA-8 reason attributed to this lead: the
	// reason of its most recent Not-Qualified attempt (see JunkBreakdown doc
	// for the multi-attempt interpretation). Empty for stale-pool junk, which
	// by definition has no attempt and therefore no reason.
	NotQualifiedReason string
	// StalePool marks junk via the M1-OA-7 aging path (unclaimed [Pool] >24h)
	// rather than via Not-Qualified attempts.
	StalePool bool
}

// JunkBreakdownResult is the computed M1 §8 rule 6 evaluation.
type JunkBreakdownResult struct {
	// Total = NotQualified + StalePool: every lead counted exactly once.
	Total int
	// NotQualified is the count of junk leads whose attempts all terminated
	// `Not Qualified`.
	NotQualified int
	// StalePool is the count of junk leads via the M1-OA-7 aging signal.
	StalePool int
	// ByReason counts NQ-junk leads per M1-OA-8 reason (stored form, so the
	// `[Lainnya ...] <teks>` fallback appears with its free text). Stale-pool
	// junk has no reason and is NOT in this map (see StalePool).
	ByReason map[string]int
	// BySource counts ALL junk leads per lead Source.
	BySource map[string]int
	// ByCampaign counts ALL junk leads per Origin Campaign; key "" groups
	// leads without an origin campaign.
	ByCampaign map[string]int
	// Leads lists every junk lead (deterministic order: lead_id) so callers
	// (Module 2 dashboards) can roll up reason-within-source/campaign without
	// re-querying.
	Leads []JunkLead
}

// JunkBreakdown computes the junk count + reason/source/campaign breakdown.
//
// Multi-attempt interpretation (contested pool leads): a lead whose competing
// attempts ALL ended `Not Qualified` is one junk lead. When those attempts
// carry different reasons, the lead is attributed to the reason of the MOST
// RECENT attempt (latest last_status_at, prospect_id as tiebreaker) so the
// reason totals always sum to the NQ-junk lead count, matching the M1 §8
// worked example (18 NQ leads -> 11+5+2 reasons). Flagged as an open
// interpretation for DECISIONS.md in the ticket report.
//
// Permission (M1 §9.1): Marketing Staff sees the breakdown for campaigns they
// own only; Marketing Lead/SPV sees all; OD read-only everywhere; Director
// full. Anyone else (including Sales) is denied -- §9.1 gives the junk
// breakdown to Marketing roles, OD, and Director only. Note the Staff scope
// (own campaigns) structurally excludes leads with no origin campaign.
func JunkBreakdown(ctx context.Context, q db.Queryer, actor authz.Identity, checker authz.Checker) (*JunkBreakdownResult, error) {
	// Division gate first (same pattern as authorizeMarketingImport): the
	// junk view belongs to Marketing; OD/Director cut across divisions.
	if !actor.Has(authz.RoleDirector) && !actor.Has(authz.RoleOD) && actor.Divisi != DivisiMarketing {
		return nil, &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "junk breakdown is restricted to Marketing, OD, and Director (M1 §9.1)"}
	}
	// Matrix check: Staff passes as own-data (scoped below to own campaigns),
	// Lead/SPV division-wide, OD/Director globally; unmapped identities deny.
	if err := checker.Check(actor, authz.Request{
		Action: authz.ActionRead, Division: DivisiMarketing, OwnerEmployeeID: actor.EmployeeID,
	}); err != nil {
		return nil, err
	}
	// Marketing Staff without a wider role is scoped to campaigns they own.
	ownCampaignsOnly := !actor.Has(authz.RoleDirector) && !actor.Has(authz.RoleOD) && !actor.Has(authz.RoleLeadSPV)

	now := time.Now().UTC()
	res := &JunkBreakdownResult{
		ByReason:   map[string]int{},
		BySource:   map[string]int{},
		ByCampaign: map[string]int{},
	}

	// ---- Part 1: leads whose attempts ALL terminated Not Qualified ---------
	// The correlated subquery picks the most recent attempt's reason (see the
	// multi-attempt interpretation above). Reason may be NULL only for rows
	// predating W1-04's mandatory-reason enforcement.
	nqQuery := `
		SELECT l.lead_id, l.source, COALESCE(l.origin_campaign, ''),
		       COALESCE((
		           SELECT pa.not_qualified_reason FROM prospect_attempts pa
		           WHERE pa.lead_id = l.lead_id
		           ORDER BY pa.last_status_at DESC, pa.prospect_id DESC
		           LIMIT 1
		       ), '')
		FROM leads l
		WHERE EXISTS (
		        SELECT 1 FROM prospect_attempts pa WHERE pa.lead_id = l.lead_id
		      )
		  AND NOT EXISTS (
		        SELECT 1 FROM prospect_attempts pa
		        WHERE pa.lead_id = l.lead_id AND pa.status <> ?
		      )`
	nqArgs := []any{string(statemachine.ProspectNotQualified)}
	if ownCampaignsOnly {
		nqQuery += `
		  AND l.origin_campaign IN (SELECT campaign_id FROM campaign_stub WHERE owner_employee_id = ?)`
		nqArgs = append(nqArgs, actor.EmployeeID)
	}
	nqQuery += `
		ORDER BY l.lead_id`

	rows, err := q.QueryContext(ctx, nqQuery, nqArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var j JunkLead
		if err := rows.Scan(&j.LeadID, &j.Source, &j.OriginCampaign, &j.NotQualifiedReason); err != nil {
			return nil, err
		}
		res.NotQualified++
		res.ByReason[j.NotQualifiedReason]++
		addJunk(res, j)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// ---- Part 2: unclaimed [Pool] leads past the 24h TTL (M1-OA-7) ---------
	// Candidates ([Pool], zero attempts) come from SQL; the stale decision
	// itself reuses the canonical IsStale helper so the TTL semantics can
	// never drift between the pool view and the junk evaluation.
	poolQuery := `
		SELECT ` + leadColumns + `
		FROM leads l
		WHERE l.record_status = ?
		  AND NOT EXISTS (SELECT 1 FROM prospect_attempts pa WHERE pa.lead_id = l.lead_id)`
	poolArgs := []any{string(StatusPool)}
	if ownCampaignsOnly {
		poolQuery += `
		  AND l.origin_campaign IN (SELECT campaign_id FROM campaign_stub WHERE owner_employee_id = ?)`
		poolArgs = append(poolArgs, actor.EmployeeID)
	}
	poolQuery += `
		ORDER BY l.lead_id`

	prows, err := q.QueryContext(ctx, poolQuery, poolArgs...)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		l, err := scanLead(prows)
		if err != nil {
			return nil, err
		}
		if !IsStale(*l, now) {
			continue // fresh pool lead: not junk (stays claimable either way)
		}
		res.StalePool++
		addJunk(res, JunkLead{
			LeadID:         l.LeadID,
			Source:         l.Source,
			OriginCampaign: l.OriginCampaign,
			StalePool:      true,
		})
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}

	res.Total = res.NotQualified + res.StalePool
	return res, nil
}

// addJunk folds one junk lead into the shared source/campaign rollups.
func addJunk(res *JunkBreakdownResult, j JunkLead) {
	res.BySource[j.Source]++
	res.ByCampaign[j.OriginCampaign]++
	res.Leads = append(res.Leads, j)
}
