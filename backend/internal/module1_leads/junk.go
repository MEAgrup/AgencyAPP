package leads

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// JunkReasonBreakdown is one row in the junk breakdown report: count of junk
// leads grouped by Not-Qualified reason (or empty for stale pool leads with
// no attempts), source, and origin campaign.
type JunkReasonBreakdown struct {
	NotQualifiedReason string // May be empty for stale pool leads
	Source             string
	OriginCampaign     string // May be empty
	Count              int
}

// JunkBreakdownResult is the return value from JunkBreakdown: total junk count
// plus the per-reason/source/campaign breakdown (M1 §8 rule 6).
type JunkBreakdownResult struct {
	TotalJunkCount int
	Breakdowns     []JunkReasonBreakdown
}

// JunkBreakdown computes the M1 §8 rule 6 bad-lead evaluation: leads treated
// as junk for source evaluation because:
//   1. ALL their attempts are terminal (Not Qualified / Rejected / Closed-Kalah
//      Kompetisi / Closed-Success), AND the lead is NOT itself [Closed - Success]
//      (because a successful lead is a client, not junk), OR
//   2. [Pool] lead aged past 24h (M1-OA-7) with zero attempts.
//
// The result includes:
//   - TotalJunkCount: the total number of junk leads
//   - Breakdowns: aggregated counts per (not_qualified_reason, source, origin_campaign)
//
// Junk breakdown respects the M1 §9.1 permission model:
//   - Marketing Staff: only leads from campaigns they own (via campaign_stubs.owner_employee_id)
//   - Marketing Lead/SPV: all marketing-sourced leads
//   - OD: read-only everywhere
//   - Director: full access
//
// If the actor is unmapped or not authorized, returns an authz.DeniedError.
func JunkBreakdown(ctx context.Context, q db.Queryer, actor authz.Identity, checker authz.Checker) (*JunkBreakdownResult, error) {
	// Authorization: unmapped identity is denied.
	if !actor.Authenticated() {
		return nil, &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "unmapped identity has no read access to junk breakdown"}
	}

	// For Marketing Staff, restrict to own campaigns; Lead/SPV and OD/Director
	// have unrestricted read access. The permission check is implicit in the
	// query scope: for Staff, we filter to campaigns they own; for others, no filter.
	var campaignOwnerFilter string
	if !actor.Has(authz.RoleDirector) && actor.Divisi == DivisiMarketing && !actor.Has(authz.RoleLeadSPV) && !actor.Has(authz.RoleOD) {
		// Marketing Staff: check own campaigns only.
		campaignOwnerFilter = fmt.Sprintf(" AND cs.owner_employee_id = %q ", actor.EmployeeID)
	} else if !actor.Has(authz.RoleDirector) && actor.Divisi != DivisiMarketing && actor.Divisi != "OD" && actor.Divisi != "Management" {
		// Not Marketing, not OD, not Director → denied.
		return nil, &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "junk breakdown is restricted to Marketing, OD, or Director"}
	}

	// Query identifies junk leads via two conditions:
	//   1. All attempts on a lead are terminal (status IN terminal states)
	//   2. OR: [Pool] lead with zero attempts and pool_entered_at > 24h ago.
	// The query groups the junk leads by (not_qualified_reason, source, origin_campaign).
	const terminalStatuses = `'[Rejected]', '[Closed - Success]', 'Closed-Kalah Kompetisi', 'Not Qualified'`

	// SQL: Join leads with prospect_attempts, group by lead to find junk,
	// then aggregate per (reason, source, campaign).
	query := `
SELECT
    COALESCE(pa.not_qualified_reason, '') as not_qualified_reason,
    l.source,
    COALESCE(l.origin_campaign, '') as origin_campaign,
    COUNT(DISTINCT l.lead_id) as count
FROM leads l
LEFT JOIN campaign_stubs cs ON l.origin_campaign = cs.campaign_id
LEFT JOIN prospect_attempts pa ON l.lead_id = pa.lead_id
WHERE
    l.record_status IN ('[Closed - Success]', '[Pool]', '[Rejected]', '[Not Qualified]')
    AND (
        -- Condition 1: All attempts are terminal (or no attempts at all for completed records)
        (l.record_status IN ('[Rejected]', '[Not Qualified]') AND NOT EXISTS (
            SELECT 1 FROM prospect_attempts pa2 WHERE pa2.lead_id = l.lead_id
            AND pa2.status NOT IN (` + terminalStatuses + `)
        ))
        OR
        -- Condition 2: [Pool] lead with zero attempts, aged > 24h
        (l.record_status = '[Pool]'
         AND NOT EXISTS (SELECT 1 FROM prospect_attempts pa3 WHERE pa3.lead_id = l.lead_id)
         AND l.pool_entered_at IS NOT NULL
         AND TIMESTAMPDIFF(HOUR, l.pool_entered_at, NOW()) >= 24)
    )
    ` + campaignOwnerFilter + `
GROUP BY l.lead_id, COALESCE(pa.not_qualified_reason, ''), l.source, COALESCE(l.origin_campaign, '')
ORDER BY l.source ASC, COALESCE(l.origin_campaign, '') ASC, COALESCE(pa.not_qualified_reason, '') ASC
`

	rows, err := q.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("leads: query junk breakdown: %w", err)
	}
	defer rows.Close()

	var breakdowns []JunkReasonBreakdown
	totalCount := 0
	seen := make(map[string]int) // Track aggregated counts per (reason, source, campaign)

	for rows.Next() {
		var reason, source, campaign string
		var count int
		if err := rows.Scan(&reason, &source, &campaign, &count); err != nil {
			return nil, fmt.Errorf("leads: scan junk row: %w", err)
		}
		// Key is (reason + source + campaign) for deduplication.
		key := fmt.Sprintf("%s|%s|%s", reason, source, campaign)

		if prevCount, exists := seen[key]; !exists {
			breakdowns = append(breakdowns, JunkReasonBreakdown{
				NotQualifiedReason: reason,
				Source:             source,
				OriginCampaign:     campaign,
				Count:              count,
			})
			seen[key] = count
		} else {
			// If somehow we get duplicates, sum them (shouldn't happen with proper GROUP BY).
			breakdowns[len(breakdowns)-1].Count += count
			seen[key] = prevCount + count
		}
		totalCount += count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &JunkBreakdownResult{
		TotalJunkCount: totalCount,
		Breakdowns:     breakdowns,
	}, nil
}
