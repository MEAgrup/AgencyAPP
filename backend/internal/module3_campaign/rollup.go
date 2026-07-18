// rollup.go — Module 3 Cluster 2 (W3-M3-C2) read-only rollups (M3 §4 Rule 4 /
// §6.3). The Campaign is a linkage HUB: it writes its id onto Leads (at import,
// module1_leads) and is stamped onto Clients (at closing, module0_sales). These
// four numbers are DERIVED on read from that linkage — never stored columns,
// always recomputable (house rules #3/#4):
//
//   - LeadsGenerated  = COUNT of Leads whose Origin Campaign is this campaign
//     (M1 §8 Rule 3 "Lead-by-Dashboard"; blocked duplicates never get a LEAD id
//     so they are excluded by construction).
//   - RealLeads       = COUNT of those Leads with >=1 attempt that REACHED
//     >= Qualified (M1 §8 Rule 4 / M1-OA-2). "Reached" is read from the immutable
//     audit log (the only edge INTO Qualified is Contacted->Qualified, config.go),
//     so a lead that later moved on (Negotiation, Closed-Lost, ...) still counts —
//     and each multi-attempt lead counts once (COUNT DISTINCT).
//   - ClientsWon      = COUNT of Clients whose Origin Campaign is this campaign
//     (M3 §4 Rule 2 — first-touch, permanent lineage; NOT the 3-month M2 credit
//     window, which is M3-OA-4 / cluster W3-M2-C1, deliberately not implemented
//     here — see report).
//   - TotalValueWon   = SUM of those Clients' Transaction total_agreed_value
//     (the closing deal value; recomputable, IDR-formatted per house rule #7).
//
// The 3-month late-conversion window (M3-OA-4) is NOT applied here; the timestamps
// it needs already exist in the data (each Client's closing audit / created_at and
// the Campaign's end_date set on [Closed]) for the M2 cluster to consume later.
package module3_campaign

import (
	"context"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Rollup is the Campaign's read-only funnel (M3 §4 Rule 4 / §6.3).
type Rollup struct {
	CampaignID     string `json:"campaign_id"`
	LeadsGenerated int    `json:"leads_generated"`
	RealLeads      int    `json:"real_leads"`
	ClientsWon     int    `json:"clients_won"`
	// TotalValueWon is the canonical DECIMAL string (recomputable); TotalValueWonIDR
	// is the house-formatted "Rp. X.XXX.XXX,00" display value (house rule #7).
	TotalValueWon    string `json:"total_value_won"`
	TotalValueWonIDR string `json:"total_value_won_idr"`
}

// Rollup returns the derived funnel for a Campaign the actor may view (§5 read
// gate, reused from Get). ErrNotFound / ErrForbidden propagate unchanged.
func (s *Service) Rollup(ctx context.Context, actor permission.Actor, campaignID string) (Rollup, error) {
	// Visibility: identical gate as the record read (§5). A campaign the actor may
	// not see is ErrForbidden; a missing one is ErrNotFound — never a leaked count.
	if _, err := s.Get(ctx, actor, campaignID); err != nil {
		return Rollup{}, err
	}

	r := Rollup{CampaignID: campaignID}

	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM leads WHERE origin_campaign_id = ?`, campaignID).
		Scan(&r.LeadsGenerated); err != nil {
		return Rollup{}, err
	}

	// Real leads: >=1 attempt reached >= Qualified. Read from the immutable audit
	// log (transition INTO Qualified); COUNT DISTINCT so a contested lead with
	// several attempts counts once.
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT l.id)
		   FROM leads l
		   JOIN prospect_attempts pa ON pa.lead_id = l.id
		   JOIN audit_log al ON al.entity_type = 'prospect_attempt'
		                    AND al.entity_id = pa.id
		                    AND al.action = 'transition:Contacted->Qualified'
		  WHERE l.origin_campaign_id = ?`, campaignID).
		Scan(&r.RealLeads); err != nil {
		return Rollup{}, err
	}

	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM clients WHERE origin_campaign_id = ?`, campaignID).
		Scan(&r.ClientsWon); err != nil {
		return Rollup{}, err
	}

	var sum string
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(t.total_agreed_value), 0)
		   FROM clients c
		   JOIN transactions t ON t.id = c.transaction_id
		  WHERE c.origin_campaign_id = ?`, campaignID).
		Scan(&sum); err != nil {
		return Rollup{}, err
	}
	m, err := money.Parse(sum)
	if err != nil {
		return Rollup{}, err
	}
	r.TotalValueWon = m.Decimal()
	r.TotalValueWonIDR = m.Format()

	return r, nil
}
