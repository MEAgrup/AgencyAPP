// metrics.go — Module 2's Auto-Metrics Engine (M2 §4). Every field is DERIVED on read
// from the Leads DB + Sales/Finance events (house rule #4) — nothing here is stored. The
// same single source of truth feeds Module 3's rollup (rollup.go), with ONE deliberate
// divergence: Attributed Sales credits the lead's LAST-TOUCH campaign (M2-OA-2), while
// M3's "Clients won" / "Total value won" credit the immutable ORIGIN campaign (M3 §4 r5).
// For a multi-touch lead the two legitimately disagree — by design, not a bug.
//
// Division-by-zero (no leads / no budget) renders "—" (house rule #7), never an error.
package module2_marketing

import (
	"context"
	"database/sql"
	"fmt"
	"math/big"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
	"github.com/meagrup/agencyapp/backend/internal/module3_campaign"
)

// emDash is the house division-by-zero render (CLAUDE.md #7): "—" (U+2014), never an error.
const emDash = "—"

// JunkReason is one Not-Qualified reason count (M2 §4 Rule 9 / Module 1 taxonomy). The
// reason label is surfaced VERBATIM as stored (no relabelling — house convention).
type JunkReason struct {
	Reason string `json:"reason"`
	Count  int    `json:"count"`
}

// Metrics is the read-only Auto-Metrics view for one Campaign (M2 §4 / §6.3). Money fields
// carry both the canonical DECIMAL string and the house IDR display; ratio fields are a
// decimal/percent string or "—" when their denominator is zero.
type Metrics struct {
	CampaignID string `json:"campaign_id"`
	Online     bool   `json:"online"`
	Offline    bool   `json:"offline"`
	// Budget is the record input; empty + BudgetIDR "—" when the campaign has no record yet
	// (used by the dashboard, where a campaign may be listed before its record is created).
	Budget    string `json:"budget"`
	BudgetIDR string `json:"budget_idr"`

	LeadByDashboard int    `json:"lead_by_dashboard"`
	LeadRealBySales int    `json:"lead_real_by_sales"`
	LeadQualityRate string `json:"lead_quality_rate"` // "NN%" or "—"

	AttributedSales    string `json:"attributed_sales"`         // IDR (Σ, never div-zero)
	AttributedSalesDec string `json:"attributed_sales_decimal"` // canonical DECIMAL
	CostPerLead        string `json:"cost_per_lead"`            // IDR or "—"
	CostPerRealLead    string `json:"cost_per_real_lead"`       // IDR or "—"
	ROAS               string `json:"roas"`                     // "X.XX" or "—" (north-star)

	CollectedSales    string `json:"collected_sales"`         // IDR (verified-received Σ)
	CollectedSalesDec string `json:"collected_sales_decimal"` // canonical DECIMAL
	CollectedROAS     string `json:"collected_roas"`          // "X.XX" or "—" (M2-OA-5)

	JunkBreakdown []JunkReason `json:"junk_breakdown"`
}

// Metrics returns the full Auto-Metrics view for a campaign the actor may view (§5 read
// gate, reused from M3 Get). The performance record must exist (budget is required to
// compute CPL/CPRL/ROAS); a campaign with no record is ErrNotFound.
func (s *Service) Metrics(ctx context.Context, actor permission.Actor, campaignID string) (Metrics, error) {
	c, err := s.campaign().Get(ctx, actor, campaignID)
	if err != nil {
		return Metrics{}, mapCampaignErr(err)
	}
	rec, err := s.loadRecord(ctx, campaignID)
	if err != nil {
		return Metrics{}, err
	}
	budget, err := money.Parse(rec.Budget)
	if err != nil {
		return Metrics{}, err
	}
	return s.computeMetrics(ctx, c, &budget)
}

// computeMetrics derives every §4 metric for one campaign. budget may be nil (a campaign
// listed on the dashboard before its record exists) — then all budget-dependent metrics
// render "—" while the lead counts, quality, attributed/collected sums still compute.
func (s *Service) computeMetrics(ctx context.Context, c module3_campaign.Campaign, budget *money.Money) (Metrics, error) {
	m := Metrics{
		CampaignID: c.ID, Online: c.Online, Offline: c.Offline,
		BudgetIDR:     emDash,
		JunkBreakdown: []JunkReason{},
	}
	if budget != nil {
		m.Budget = budget.Decimal()
		m.BudgetIDR = budget.Format()
	}

	// Lead-by-Dashboard = COUNT leads with Origin Campaign = this campaign (M2 §4 r1;
	// identical to M3 rollup LeadsGenerated — one source of truth).
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM leads WHERE origin_campaign_id = ?`, c.ID).
		Scan(&m.LeadByDashboard); err != nil {
		return Metrics{}, err
	}

	// Lead-Real-by-Sales = COUNT DISTINCT leads (Origin) with >=1 attempt that REACHED
	// Qualified — read from the immutable audit log (the only edge INTO Qualified is
	// Contacted->Qualified). Byte-identical to rollup.go's real_leads query (M2 §4 r2).
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT l.id)
		   FROM leads l
		   JOIN prospect_attempts pa ON pa.lead_id = l.id
		   JOIN audit_log al ON al.entity_type = 'prospect_attempt'
		                    AND al.entity_id = pa.id
		                    AND al.action = 'transition:Contacted->Qualified'
		  WHERE l.origin_campaign_id = ?`, c.ID).
		Scan(&m.LeadRealBySales); err != nil {
		return Metrics{}, err
	}

	// Attributed Sales (LAST-TOUCH, M2-OA-2) + Collected (verified-received, M2-OA-5),
	// both inside the 3-month post-Close window (M3-OA-4).
	attributed, collected, err := s.attributedAndCollected(ctx, c)
	if err != nil {
		return Metrics{}, err
	}
	m.AttributedSales = attributed.Format()
	m.AttributedSalesDec = attributed.Decimal()
	m.CollectedSales = collected.Format()
	m.CollectedSalesDec = collected.Decimal()

	// Junk breakdown (M2 §4 r9 / Module 1): NQ reason counts for this campaign's Origin
	// leads, labels verbatim.
	junk, err := s.junkBreakdown(ctx, c.ID)
	if err != nil {
		return Metrics{}, err
	}
	m.JunkBreakdown = junk

	// Derived ratios (M2 §4 r3/r5/r6/r7/r8). Division-by-zero -> "—".
	m.LeadQualityRate = percentRound(m.LeadRealBySales, m.LeadByDashboard)
	if budget != nil {
		m.CostPerLead = moneyDivCount(*budget, m.LeadByDashboard)
		m.CostPerRealLead = moneyDivCount(*budget, m.LeadRealBySales)
		m.ROAS = ratio2dp(int64(attributed), int64(*budget))
		m.CollectedROAS = ratio2dp(int64(collected), int64(*budget))
	} else {
		m.CostPerLead, m.CostPerRealLead, m.ROAS, m.CollectedROAS = emDash, emDash, emDash, emDash
	}
	return m, nil
}

// attributedAndCollected sums, over every won client whose lead's LAST-TOUCH campaign is
// this one (M2-OA-2): the closing/booked deal value (Attributed Sales, headline ROAS
// basis) and the verified-received amount (Collected, Collected-ROAS basis, M2-OA-5).
//
// Verified-received per transaction mirrors module5_finance.Transaction.AmountVerified
// EXACTLY (rollup.go:70 + transaction.go directVerifiedTotal): Σ [Terverifikasi]
// installment amounts + Σ direct verifications (payment_verifications with NULL
// installment_id) — recomputable from the same immutable ledger, never a stored running
// column.
//
// Window (M3-OA-4): when the campaign has been Closed (end_date set — it persists into
// Archived), a win dated MORE than 3 months after end_date no longer credits the campaign.
// The win date is the immutable "closing" audit event (audit_log, house rule #3), falling
// back to the client's created_at (both are the closing instant); it is NOT "now", so no
// clock is consulted here — the window is a pure end_date vs win_date comparison.
func (s *Service) attributedAndCollected(ctx context.Context, c module3_campaign.Campaign) (money.Money, money.Money, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT COALESCE(t.total_agreed_value, 0) AS booked,
		        COALESCE((SELECT SUM(i.amount) FROM installments i
		                   WHERE i.transaction_id = t.id AND i.status = '[Terverifikasi]'), 0)
		      + COALESCE((SELECT SUM(pv.amount) FROM payment_verifications pv
		                   WHERE pv.transaction_id = t.id AND pv.installment_id IS NULL), 0) AS verified,
		        COALESCE((SELECT MIN(al.created_at) FROM audit_log al
		                   WHERE al.entity_type = 'client' AND al.entity_id = c.id
		                     AND al.action = 'closing'), c.created_at) AS win_at
		   FROM clients c
		   JOIN leads l ON l.id = c.lead_id
		   JOIN transactions t ON t.id = c.transaction_id
		  WHERE l.last_touch_campaign_id = ?`, c.ID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	// Window cutoff: only when the campaign has an end_date (has been Closed).
	var haveCutoff bool
	var cutoff time.Time
	if c.EndDate != nil {
		end, perr := time.ParseInLocation("2006-01-02", *c.EndDate, tz.WIB)
		if perr != nil {
			return 0, 0, perr
		}
		cutoff = end.AddDate(0, 3, 0) // one quarter after Close (M3-OA-4)
		haveCutoff = true
	}

	var attributed, collected money.Money
	for rows.Next() {
		var bookedDec, verifiedDec string
		var winAt time.Time
		if err := rows.Scan(&bookedDec, &verifiedDec, &winAt); err != nil {
			return 0, 0, err
		}
		if haveCutoff && tz.Date(winAt).After(cutoff) {
			continue // won more than 3 months after Close — no longer credited (M3-OA-4)
		}
		booked, err := money.Parse(bookedDec)
		if err != nil {
			return 0, 0, err
		}
		verified, err := money.Parse(verifiedDec)
		if err != nil {
			return 0, 0, err
		}
		attributed += booked
		collected += verified
	}
	return attributed, collected, rows.Err()
}

// junkBreakdown returns the Not-Qualified reason counts for this campaign's Origin leads
// (M2 §4 r9). Reason labels are surfaced VERBATIM. Ordered by count desc then label for a
// stable, comparable presentation.
func (s *Service) junkBreakdown(ctx context.Context, campaignID string) ([]JunkReason, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT r.reason, COUNT(*) AS c
		   FROM prospect_attempt_nq_reasons r
		   JOIN prospect_attempts pa ON pa.id = r.attempt_id
		   JOIN leads l ON l.id = pa.lead_id
		  WHERE l.origin_campaign_id = ?
		  GROUP BY r.reason
		  ORDER BY c DESC, r.reason`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []JunkReason{}
	for rows.Next() {
		var j JunkReason
		if err := rows.Scan(&j.Reason, &j.Count); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// Dashboard is the Lead/Staff dashboard split (M2 §5). It returns the metrics view for
// every Campaign the actor may see (§5 visibility, reused from M3 List): a Marketing staff
// gets only OWN campaigns; a Marketing lead/head, OD, or Director gets ALL — so the lead
// can compare CPL/CPRL/ROAS/Quality across campaigns and staff. Campaigns without a
// performance record yet still appear (budget-dependent metrics render "—").
func (s *Service) Dashboard(ctx context.Context, actor permission.Actor) ([]Metrics, error) {
	campaigns, err := s.campaign().List(ctx, actor)
	if err != nil {
		return nil, mapCampaignErr(err)
	}
	out := make([]Metrics, 0, len(campaigns))
	for _, c := range campaigns {
		budget, err := s.budgetFor(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		m, err := s.computeMetrics(ctx, c, budget)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// budgetFor loads the campaign's record budget, or nil when no record exists yet.
func (s *Service) budgetFor(ctx context.Context, campaignID string) (*money.Money, error) {
	var dec string
	err := s.DB.QueryRowContext(ctx,
		`SELECT budget FROM marketing_performance_records WHERE campaign_id = ?`, campaignID).Scan(&dec)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	amt, err := money.Parse(dec)
	if err != nil {
		return nil, err
	}
	return &amt, nil
}

// ---- ratio / money-division renderers (house rule #7: div-zero -> "—") ----

// moneyDivCount renders budget / count as house IDR, or "—" when count is 0. The division
// is exact in minor units (cents), then money.Format drops cents for display.
func moneyDivCount(budget money.Money, count int) string {
	if count <= 0 {
		return emDash
	}
	return money.Money(int64(budget) / int64(count)).Format()
}

// ratio2dp renders num/den to two decimals (e.g. ROAS "4.38"), or "—" when den is 0. Both
// operands are minor-unit integers, so the ratio is unit-free. Rounded half-up via math/big.
func ratio2dp(num, den int64) string {
	if den == 0 {
		return emDash
	}
	// hundredths = round(num*100 / den)
	n := new(big.Int).Mul(big.NewInt(num), big.NewInt(100))
	d := big.NewInt(den)
	h := roundHalfUpDiv(n, d)
	neg := ""
	if h.Sign() < 0 {
		neg = "-"
		h.Abs(h)
	}
	whole := new(big.Int).Quo(h, big.NewInt(100))
	frac := new(big.Int).Mod(h, big.NewInt(100))
	return fmt.Sprintf("%s%s.%02d", neg, whole.String(), frac.Int64())
}

// percentRound renders num/den as an integer percentage string "NN%" (rounded half-up),
// or "—" when den is 0 (M2 §4 r3 / r8). Matches the PRD's "26%" presentation.
func percentRound(num, den int) string {
	if den == 0 {
		return emDash
	}
	n := new(big.Int).Mul(big.NewInt(int64(num)), big.NewInt(100))
	pct := roundHalfUpDiv(n, big.NewInt(int64(den)))
	return pct.String() + "%"
}

// roundHalfUpDiv returns round(num/den) with .5 rounded away from zero. den != 0.
func roundHalfUpDiv(num, den *big.Int) *big.Int {
	neg := (num.Sign() < 0) != (den.Sign() < 0)
	n := new(big.Int).Abs(num)
	d := new(big.Int).Abs(den)
	half := new(big.Int).Quo(d, big.NewInt(2))
	n.Add(n, half)
	q := new(big.Int).Quo(n, d)
	if neg {
		q.Neg(q)
	}
	return q
}
