// This file implements periodic metrics (M8 §5) and the attribution feedback loop
// to Creative (§7). Both derive purely from immutable rows (house rules 3/4):
//
//   - Total Spend / Total GMV = Σ of the Metric-Entry spend / gmv columns; ROAS =
//     Total GMV ÷ Total Spend (§5 Rule 3). Division-by-zero renders "—" (house
//     rule 7). These are NEVER stored as running columns — see read.go.
//   - Attributed GMV per Creative Asset (§7) is Σ over the per-entry linked-Asset
//     SNAPSHOT (metric_entry_assets) of entry.gmv split EQUALLY across that entry's
//     snapshot Assets (§7 Rule 2). Recording the snapshot at entry time makes the
//     Creative-Swap rule (§7 Rule 3) automatic and the whole value recomputable
//     from immutable rows. It is materialised onto assets.attributed_gmv (§7 Rule 1
//     "writes it back to that Asset's field"; Rule 4 "only Ads/Reporting writes
//     it") but ALWAYS as a from-scratch recompute, so it is a cache, never
//     independently mutable.
package module8_ads

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// MetricInput carries a §9.4 Metric Entry. Entered By is the actor.
type MetricInput struct {
	PeriodStart string   // "YYYY-MM-DD"
	PeriodEnd   string   // "YYYY-MM-DD"
	Spend       string   // decimal string (Rp)
	GMV         string   // decimal string (Rp)
	CTR         *float64 // optional %
	CVR         *float64 // optional %
	EntryMethod string   // Manual | File Export
}

// MetricEntry is one recorded §9.4 row (returned to the caller).
type MetricEntry struct {
	ID          string    `json:"id"`
	CampaignID  string    `json:"campaign_id"`
	PeriodStart string    `json:"period_start"`
	PeriodEnd   string    `json:"period_end"`
	Spend       float64   `json:"spend"`
	GMV         float64   `json:"gmv"`
	EntryMethod string    `json:"entry_method"`
	EnteredBy   string    `json:"entered_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// LogMetricEntry records one periodic Metric Entry (§5 Flow 1) and refreshes the
// Attributed GMV of every Asset the entry touched (§7 Flow 1). Ads staff/lead
// (the Advertiser) or Director. Spend/GMV are additive raw inputs; the running
// totals and ROAS are derived on read, never stored.
func (s *Service) LogMetricEntry(ctx context.Context, actor permission.Actor, campaignID string, in MetricInput) (MetricEntry, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return MetricEntry{}, err
	}
	defer tx.Rollback()

	r, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return MetricEntry{}, err
	}
	if !canManageCampaign(actor) {
		return MetricEntry{}, ErrCampaignManageForbidden
	}
	// COO decision 2026-07-20 (DECISIONS.md): a campaign in the terminal [Ended]
	// status no longer accepts Metric Entries. Gated server-side after the row lock
	// (mirrors the O13 import gate), so a raced End cannot slip an entry in. Only
	// [Ended] is blocked — [Paused] still accepts entries for running/late periods.
	if r.status == StatusEnded {
		return MetricEntry{}, ErrCampaignEnded
	}
	method := strings.TrimSpace(in.EntryMethod)
	if strings.TrimSpace(in.PeriodStart) == "" || strings.TrimSpace(in.PeriodEnd) == "" ||
		strings.TrimSpace(in.Spend) == "" || strings.TrimSpace(in.GMV) == "" || method == "" {
		return MetricEntry{}, ErrIncomplete
	}
	if !validEntryMethods[method] {
		return MetricEntry{}, ErrInvalidEntryMethod
	}
	spend, err := money.Parse(in.Spend)
	if err != nil {
		return MetricEntry{}, ErrBadAmount
	}
	gmv, err := money.Parse(in.GMV)
	if err != nil {
		return MetricEntry{}, ErrBadAmount
	}
	if spend < 0 || gmv < 0 {
		return MetricEntry{}, ErrNegativeAmount
	}
	pStart, pEnd, err := parsePeriod(in.PeriodStart, in.PeriodEnd)
	if err != nil {
		return MetricEntry{}, ErrInvalidPeriod
	}

	id, err := ident.Next(ctx, tx, "MTR", time.Now())
	if err != nil {
		return MetricEntry{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO metric_entries
		   (id, campaign_id, period_start, period_end, spend, gmv, ctr, cvr, entry_method, entered_by, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, campaignID, pStart, pEnd, spend.Decimal(), gmv.Decimal(),
		nullFloat(in.CTR), nullFloat(in.CVR), method, actor.EmployeeID, actor.EmployeeID); err != nil {
		return MetricEntry{}, err
	}
	// §7 Flow 1: snapshot the Assets linked to the campaign AT THIS MOMENT — the
	// immutable basis for equal-split attribution (Creative-Swap-safe, §7 Rule 3).
	linked, err := currentlyLinkedAssets(ctx, tx, campaignID)
	if err != nil {
		return MetricEntry{}, err
	}
	for _, assetID := range linked {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO metric_entry_assets (metric_entry_id, asset_id) VALUES (?, ?)`, id, assetID); err != nil {
			return MetricEntry{}, err
		}
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "ad_campaign", EntityID: campaignID, Actor: actor.EmployeeID, Action: "metric_entry_logged",
		After: map[string]any{"metric_entry_id": id, "spend": spend.Decimal(), "gmv": gmv.Decimal(), "linked_assets": linked},
	}); err != nil {
		return MetricEntry{}, err
	}
	// §7 Flow 1: recompute Attributed GMV for each Asset this entry touched.
	for _, assetID := range linked {
		if err := recomputeAssetAttribution(ctx, tx, assetID); err != nil {
			return MetricEntry{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MetricEntry{}, err
	}
	return MetricEntry{
		ID: id, CampaignID: campaignID, PeriodStart: pStart, PeriodEnd: pEnd,
		Spend: float64(spend) / 100, GMV: float64(gmv) / 100,
		EntryMethod: method, EnteredBy: actor.EmployeeID, CreatedAt: time.Now(),
	}, nil
}

// recomputeAssetAttribution rebuilds one Asset's Attributed GMV from scratch (§7)
// over every Metric Entry that snapshotted it, ACROSS all campaigns the Asset is
// linked to: for each such entry, the Asset gets entry.gmv ÷ (Assets in that
// entry's snapshot). The result is written back to assets.attributed_gmv. Being a
// full recompute over immutable rows, it is idempotent and recomputable at any time
// (house rule 4). Integer minor-unit division drops sub-rupiah remainders, which
// never surface in the IDR display (house rule 7).
func recomputeAssetAttribution(ctx context.Context, tx *sql.Tx, assetID string) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT me.gmv, cnt.n
		   FROM metric_entry_assets mea
		   JOIN metric_entries me ON me.id = mea.metric_entry_id
		   JOIN (SELECT metric_entry_id, COUNT(*) AS n FROM metric_entry_assets GROUP BY metric_entry_id) cnt
		     ON cnt.metric_entry_id = mea.metric_entry_id
		  WHERE mea.asset_id = ?`, assetID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var total money.Money
	for rows.Next() {
		var gmvStr string
		var n int64
		if err := rows.Scan(&gmvStr, &n); err != nil {
			return err
		}
		gmv, err := money.Parse(gmvStr)
		if err != nil {
			return err
		}
		if n > 0 {
			total += money.Money(int64(gmv) / n) // equal split, minor-unit floor
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE assets SET attributed_gmv = ? WHERE id = ?`, total.Decimal(), assetID)
	return err
}

// parsePeriod validates a metric period ("YYYY-MM-DD" each) and end >= start.
func parsePeriod(startStr, endStr string) (string, string, error) {
	start, err := time.Parse("2006-01-02", strings.TrimSpace(startStr))
	if err != nil {
		return "", "", err
	}
	end, err := time.Parse("2006-01-02", strings.TrimSpace(endStr))
	if err != nil {
		return "", "", err
	}
	if end.Before(start) {
		return "", "", errors.New("period end before start")
	}
	return start.Format("2006-01-02"), end.Format("2006-01-02"), nil
}

func nullFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
