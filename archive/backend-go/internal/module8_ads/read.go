// This file implements the read side of Module 8: the Ad Campaign record with its
// DERIVED performance metrics (§5) — never stored as columns, always recomputed
// from the immutable Metric-Entry rows (house rules 3/4). Money renders in the
// house IDR convention and a ROAS with no spend renders "—" (house rule 7).
package module8_ads

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Campaign is one Ad Campaign (ADC-) with its derived performance view (§9.3 +
// §5). The raw float fields carry whole-rupiah values for programmatic use; the
// *Display fields carry the house IDR / ROAS rendering.
type Campaign struct {
	ID            string  `json:"id"`
	BriefID       string  `json:"brief_id"`
	ClientID      string  `json:"client_id"`
	Platform      string  `json:"platform"`
	Objective     string  `json:"objective"`
	Budget        float64 `json:"budget"`
	BudgetDisplay string  `json:"budget_display"`
	StartDate     string  `json:"start_date"`
	EndDate       string  `json:"end_date"`
	TargetKPI     string  `json:"target_kpi"`
	Status        string  `json:"status"`

	// Derived running metrics (§5 Rule 2/3), recomputed from Metric Entries.
	TotalSpend        float64  `json:"total_spend"`
	TotalSpendDisplay string   `json:"total_spend_display"` // "Rp. X.XXX.XXX,00"
	TotalGMV          float64  `json:"total_gmv"`
	TotalGMVDisplay   string   `json:"total_gmv_display"`
	ROAS              *float64 `json:"roas"`         // nil when Total Spend == 0
	ROASDisplay       string   `json:"roas_display"` // "3.875x" | "—"

	LinkedAssetIDs    []string `json:"linked_asset_ids"` // currently linked
	MetricEntryCount  int      `json:"metric_entry_count"`
	OptimizationCount int      `json:"optimization_count"` // §8 Rule 4 secondary signal

	// §8 Rule 4 / M8-OA-5: ROAS below the (ROAS-type) Target KPI for consecutive
	// metric-entry periods. Escalation NOTIFICATION is deferred (FROZEN catalog has
	// no m8 event); this derived signal is the visible substitute.
	UnderperformingStreak int  `json:"underperforming_streak"`
	EscalationFlagged     bool `json:"escalation_flagged"` // streak >= 2

	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// GetCampaign returns an Ad Campaign with its derived metrics, if the actor may
// view it (§9.1 read gate). Recompute-from-log: Total Spend/GMV/ROAS come from the
// Metric-Entry rows, not from any stored column.
func (s *Service) GetCampaign(ctx context.Context, actor permission.Actor, campaignID string) (Campaign, error) {
	var c Campaign
	var budgetStr string
	var startDate, endDate time.Time
	var owner sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT c.id, c.brief_id, c.client_id, c.platform, c.objective, c.budget,
		        c.start_date, c.end_date, c.target_kpi, c.status, c.created_by, c.created_at,
		        cl.assigned_am_id
		   FROM ad_campaigns c
		   JOIN clients cl ON cl.id = c.client_id
		  WHERE c.id = ?`, campaignID).
		Scan(&c.ID, &c.BriefID, &c.ClientID, &c.Platform, &c.Objective, &budgetStr,
			&startDate, &endDate, &c.TargetKPI, &c.Status, &c.CreatedBy, &c.CreatedAt, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return Campaign{}, ErrCampaignNotFound
	}
	if err != nil {
		return Campaign{}, err
	}
	if !canViewCampaign(actor, owner.String) {
		return Campaign{}, ErrCampaignViewForbidden
	}
	if b, err := money.Parse(budgetStr); err == nil {
		c.Budget = float64(b) / 100
		c.BudgetDisplay = b.Format()
	}
	c.StartDate = startDate.Format("2006-01-02")
	c.EndDate = endDate.Format("2006-01-02")

	if err := s.fillDerived(ctx, &c); err != nil {
		return Campaign{}, err
	}
	return c, nil
}

// campaignViewGate authorizes a §9.1 read of the campaign identified by campaignID,
// returning ErrCampaignNotFound / ErrCampaignViewForbidden. Additive read-only helper
// (W2-API-2): shared by the append-only child-row list reads below so the HTTP layer
// stays thin and the module boundary keeps ownership of the query.
func (s *Service) campaignViewGate(ctx context.Context, actor permission.Actor, campaignID string) error {
	var owner sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT cl.assigned_am_id FROM ad_campaigns c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`,
		campaignID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCampaignNotFound
	}
	if err != nil {
		return err
	}
	if !canViewCampaign(actor, owner.String) {
		return ErrCampaignViewForbidden
	}
	return nil
}

// ListMetricEntries returns a campaign's Metric Entries (§5) in period order if the
// actor may view the campaign (§9.1). Append-only child rows — no edit/delete path
// exists. Additive read-only helper (W2-API-2 wiring support).
func (s *Service) ListMetricEntries(ctx context.Context, actor permission.Actor, campaignID string) ([]MetricEntry, error) {
	if err := s.campaignViewGate(ctx, actor, campaignID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_at
		   FROM metric_entries WHERE campaign_id = ? ORDER BY period_start, id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MetricEntry{}
	for rows.Next() {
		var m MetricEntry
		var start, end time.Time
		var spendStr, gmvStr string
		if err := rows.Scan(&m.ID, &m.CampaignID, &start, &end, &spendStr, &gmvStr,
			&m.EntryMethod, &m.EnteredBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.PeriodStart = start.Format("2006-01-02")
		m.PeriodEnd = end.Format("2006-01-02")
		if sp, e := money.Parse(spendStr); e == nil {
			m.Spend = float64(sp) / 100
		}
		if gm, e := money.Parse(gmvStr); e == nil {
			m.GMV = float64(gm) / 100
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListOptimizations returns a campaign's Optimization Log (§6) in id order if the actor
// may view the campaign (§9.1). Append-only child rows — no edit/delete path exists.
// Additive read-only helper (W2-API-2 wiring support).
func (s *Service) ListOptimizations(ctx context.Context, actor permission.Actor, campaignID string) ([]Optimization, error) {
	if err := s.campaignViewGate(ctx, actor, campaignID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, campaign_id, change_type, before_value, after_value, reason, actor, created_at
		   FROM optimization_logs WHERE campaign_id = ? ORDER BY id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Optimization{}
	for rows.Next() {
		var o Optimization
		if err := rows.Scan(&o.ID, &o.CampaignID, &o.ChangeType, &o.BeforeValue, &o.AfterValue,
			&o.Reason, &o.Actor, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// fillDerived computes the §5 running metrics + §8 signals from immutable rows.
func (s *Service) fillDerived(ctx context.Context, c *Campaign) error {
	// Running totals + ROAS from Metric Entries (§5 Rule 2/3).
	var totalSpend, totalGMV money.Money
	perEntryROAS, err := s.metricSeries(ctx, c.ID, &totalSpend, &totalGMV)
	if err != nil {
		return err
	}
	c.TotalSpend = float64(totalSpend) / 100
	c.TotalGMV = float64(totalGMV) / 100
	c.TotalSpendDisplay = totalSpend.Format()
	c.TotalGMVDisplay = totalGMV.Format()
	c.MetricEntryCount = len(perEntryROAS)
	if totalSpend == 0 {
		c.ROAS = nil
		c.ROASDisplay = "—" // house rule 7: division-by-zero
	} else {
		roas := float64(totalGMV) / float64(totalSpend)
		c.ROAS = &roas
		c.ROASDisplay = formatROAS(roas)
	}

	// §8 Rule 4 / M8-OA-5: trailing consecutive under-target periods (ROAS target).
	if target, ok := ParseROASTarget(c.TargetKPI); ok {
		c.UnderperformingStreak = trailingUnderTarget(perEntryROAS, target)
		c.EscalationFlagged = c.UnderperformingStreak >= 2
	}

	// Currently-linked Assets (§4 Rule 2) + Optimization activity count (§8 Rule 4).
	linked, err := currentlyLinkedAssets(ctx, s.DB, c.ID)
	if err != nil {
		return err
	}
	c.LinkedAssetIDs = linked
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM optimization_logs WHERE campaign_id = ?`, c.ID).Scan(&c.OptimizationCount); err != nil {
		return err
	}
	return nil
}

// metricSeries loads the campaign's Metric Entries in period order, accumulating
// the running Spend/GMV totals and returning the per-entry ROAS (spend==0 -> a
// sentinel below any positive target so it counts as under-performing).
func (s *Service) metricSeries(ctx context.Context, campaignID string, totalSpend, totalGMV *money.Money) ([]float64, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT spend, gmv FROM metric_entries WHERE campaign_id = ? ORDER BY period_start, id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var series []float64
	for rows.Next() {
		var spendStr, gmvStr string
		if err := rows.Scan(&spendStr, &gmvStr); err != nil {
			return nil, err
		}
		spend, err := money.Parse(spendStr)
		if err != nil {
			return nil, err
		}
		gmv, err := money.Parse(gmvStr)
		if err != nil {
			return nil, err
		}
		*totalSpend += spend
		*totalGMV += gmv
		if spend == 0 {
			series = append(series, 0) // no spend this period -> under any positive target
		} else {
			series = append(series, float64(gmv)/float64(spend))
		}
	}
	return series, rows.Err()
}

// trailingUnderTarget counts how many of the MOST RECENT consecutive periods have
// a per-entry ROAS strictly below the target (§8 Rule 4 / M8-OA-5).
func trailingUnderTarget(series []float64, target float64) int {
	n := 0
	for i := len(series) - 1; i >= 0; i-- {
		if series[i] < target {
			n++
		} else {
			break
		}
	}
	return n
}

// ParseROASTarget extracts a numeric ROAS target from a Target KPI string like
// "ROAS ≥ 4x" or "ROAS 4". Returns ok=false when the target is not ROAS-typed or
// carries no number — no false escalation for GMV/Spend-cap targets. Exported
// for module13_health's ROAS Attainment (M13 Rule 5) — one parser, no mirror
// (O19 precedent).
func ParseROASTarget(target string) (float64, bool) {
	low := strings.ToLower(target)
	if !strings.Contains(low, "roas") {
		return 0, false
	}
	// pull the first numeric token (integer or decimal).
	var b strings.Builder
	started := false
	for _, ch := range low {
		if (ch >= '0' && ch <= '9') || (ch == '.' && started) {
			b.WriteRune(ch)
			started = true
		} else if started {
			break
		}
	}
	if b.Len() == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(b.String(), 64)
	if err != nil || v <= 0 {
		return 0, false
	}
	return v, true
}

// formatROAS renders a ROAS ratio as "N.NNNx" with trailing zeros trimmed
// (e.g. 4.75 -> "4.75x", 3.875 -> "3.875x", 4 -> "4x").
func formatROAS(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64) + "x"
}
