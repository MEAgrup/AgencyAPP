package leads

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// StaleTTL is the M1-OA-7 pool aging threshold: an unclaimed [Pool] lead past
// this age is flagged "stale" — visible so Sales can (de)prioritise it — but
// stays claimable in [Pool]; it is never removed or auto-recycled.
const StaleTTL = 24 * time.Hour

// PoolLead is a pool-view row: the lead plus its COMPUTED stale flag. The flag
// is derived from pool_entered_at at query time (house convention #4:
// auto-calculated fields are computed, never stored/user-typed).
type PoolLead struct {
	Lead
	Stale bool
}

// IsStale computes the M1-OA-7 flag for a lead at time now.
func IsStale(l Lead, now time.Time) bool {
	return l.RecordStatus == StatusPool && !l.PoolEnteredAt.IsZero() &&
		now.Sub(l.PoolEnteredAt) >= StaleTTL
}

// ListPool returns every [Pool] lead with its computed stale flag. A [Pool]
// lead with zero attempts appears in no salesperson's workspace (workspaces
// are attempt-driven, owned by M0) — this Pool view is the §6 claim surface.
//
// Visibility (§9.1): any resolved internal identity may read the pool — Sales
// Staff need it to self-claim (contested by design), Marketing keeps read-only
// attribution visibility, OD is read-only everywhere, Director full. An
// unmapped identity is denied.
func ListPool(ctx context.Context, q db.Queryer, actor authz.Identity, now time.Time) ([]PoolLead, error) {
	if !actor.Authenticated() {
		return nil, &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "unmapped identity has no read access to the lead pool"}
	}
	rows, err := q.QueryContext(ctx,
		`SELECT `+leadColumns+` FROM leads WHERE record_status = ? ORDER BY pool_entered_at, lead_id`,
		string(StatusPool))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PoolLead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, PoolLead{Lead: *l, Stale: IsStale(*l, now)})
	}
	return out, rows.Err()
}

// LeadByDashboard is the §8 rule 3 campaign counter: the number of LEAD
// records whose Origin Campaign is campaignID. Blocked duplicates never create
// records (§5 row 2 blocks the second record) and never count (M1-OA-6), so a
// plain count over origin_campaign is exactly the PRD definition. [Pool] leads
// with zero attempts DO count (§2). Read-only, always recomputed — never
// stored.
//
// Visibility (§9.1): Marketing Staff may only read counters for campaigns they
// own; Marketing Lead/SPV all campaigns; OD/Director everywhere.
func LeadByDashboard(ctx context.Context, q db.Queryer, checker authz.Checker, actor authz.Identity, campaignID string) (int, error) {
	campaign, err := getCampaignStub(ctx, q, campaignID)
	if err != nil {
		return 0, err
	}
	if err := checker.Check(actor, authz.Request{
		Action: authz.ActionRead, Division: DivisiMarketing, OwnerEmployeeID: campaign.OwnerEmployeeID,
	}); err != nil {
		return 0, err
	}
	var n int
	err = q.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM leads WHERE origin_campaign = ?`, campaignID).Scan(&n)
	return n, err
}

// ListByCampaign returns every lead whose Origin Campaign is campaignID, for
// the Marketing views (§3 rule 7): Marketing Staff sees only leads from
// campaigns they own; the Marketing Lead sees all; OD/Director read
// everywhere.
func ListByCampaign(ctx context.Context, q db.Queryer, checker authz.Checker, actor authz.Identity, campaignID string) ([]Lead, error) {
	campaign, err := getCampaignStub(ctx, q, campaignID)
	if err != nil {
		return nil, err
	}
	if err := checker.Check(actor, authz.Request{
		Action: authz.ActionRead, Division: DivisiMarketing, OwnerEmployeeID: campaign.OwnerEmployeeID,
	}); err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx,
		`SELECT `+leadColumns+` FROM leads WHERE origin_campaign = ? ORDER BY lead_id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Lead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// MarketingCanEdit is the M1-OA-5 edit lock: once a lead has an active Sales
// attempt, Marketing may no longer edit it (read-only attribution visibility
// remains). Within W1-01/02 the record states that imply an active/terminal
// Sales engagement are Scouted-Active and [Closed - Success]; a claimed pool
// lead also locks once W1-03 marks attempts on the record (see build report —
// the claim path is W1-03's ticket).
func MarketingCanEdit(l Lead) bool {
	switch l.RecordStatus {
	case StatusPool, StatusRejected, StatusNotQualified:
		return true
	default:
		return false
	}
}

// MarketingEditInput are the correctable intake fields (M1 §3). Nil = leave
// unchanged. Phone is NOT editable here — the normalized phone is the dedup
// identity of the record; changing it is a merge/split operation outside v1
// scope.
type MarketingEditInput struct {
	LeadName *string
	Email    *string
}

// EditLeadByMarketing applies a Marketing correction to a lead's intake
// fields, enforcing §3 rules 7–8: actor must be Marketing (Staff limited to
// leads of campaigns they own, Lead/SPV division-wide, Director full), and the
// lead must not have an active Sales attempt (M1-OA-5 — violations return
// *authz.DeniedError). The change appends a before→after audit row.
func (s *Service) EditLeadByMarketing(ctx context.Context, conn *sql.DB, actor authz.Identity, leadID string, in MarketingEditInput) (*Lead, error) {
	if in.LeadName != nil && *in.LeadName == "" {
		return nil, &ValidationError{Message: MsgDataTidakLengkapForm}
	}

	var updated *Lead
	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		l, err := GetLead(ctx, tx, leadID)
		if err != nil {
			return err
		}
		if !actor.Has(authz.RoleDirector) && actor.Divisi != DivisiMarketing {
			return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "lead intake edits are restricted to the Marketing division"}
		}
		// Own-campaign scope for Staff, division-wide for Lead/SPV.
		owner := ""
		if l.OriginCampaign != "" {
			if c, err := getCampaignStub(ctx, tx, l.OriginCampaign); err == nil {
				owner = c.OwnerEmployeeID
			}
		}
		if err := s.checker.Check(actor, authz.Request{
			Action: authz.ActionWrite, Division: DivisiMarketing, OwnerEmployeeID: owner,
		}); err != nil {
			return err
		}
		if !MarketingCanEdit(*l) {
			return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "lead has an active Sales attempt; Marketing is read-only (M1-OA-5)"}
		}

		before := leadAfterDoc(*l)
		next := *l
		if in.LeadName != nil {
			next.LeadName = *in.LeadName
		}
		if in.Email != nil {
			next.Email = *in.Email
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE leads SET lead_name = ?, email = ?, updated_at = ? WHERE lead_id = ?`,
			next.LeadName, nullStr(next.Email), now, leadID); err != nil {
			return err
		}
		if err := s.auditLead(ctx, tx, actor.EmployeeID, leadID, "correction", before, leadAfterDoc(next)); err != nil {
			return err
		}
		updated = &next
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}
