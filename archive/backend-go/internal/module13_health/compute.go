package module13_health

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module8_ads"
)

// Severity penalties for the Complaints component (M13 §2 Rule 5 / §6 OA-4,
// using Module 6's now-resolved 3-tier scale). Working defaults, adjustable once
// real data comes in (§2 Rule 5).
const (
	penaltyLow    = 5
	penaltyMedium = 15
	penaltyHigh   = 30
)

// adCampaignActiveStatus mirrors module8_ads' launched status. A Client "has an
// active Ads service" (Rule 13 default) when it has at least one campaign here.
const adCampaignActiveStatus = "[Active]"

// installmentOverdueStatus is module5_finance's [Jatuh Tempo] label — an
// installment that ever transitioned INTO it broke Payment Timeliness (Rule 5).
const installmentOverdueStatus = "[Jatuh Tempo]"

// adsBriefDivision: an Ads Brief runs the canonical Task machine as a
// Brief-as-task (M8 / M12), so those briefs are counted directly in Task
// Completion / Revision Burden. Creative work is counted via its Assets; KOL
// Bookings (M9) and Live-Stream Sessions (M10) are off-machine mapped sources and
// are deliberately out of scope for v1 (see DECISIONS / cluster report).
const adsBriefDivision = "Ads"

// period is one scored calendar month, in WIB (O20). It carries every window
// bound the component gatherers need: DATE bounds for date columns (due_date,
// metric period_start), a [startUTC, endUTC) instant window for DATETIME columns
// (audit created_at, complaints created_at), the "YYYY-MM" tag that matches
// module12's ApprovedPeriodWIB, and the "YYYYMM" id-bucket.
type period struct {
	start       time.Time // WIB midnight, first day of month
	endDate     string    // last day of month, "2006-01-02" (inclusive DATE upper bound)
	startDate   string    // first day, "2006-01-02"
	startUTC    time.Time // start instant in UTC (inclusive)
	endUTC      time.Time // next-month start in UTC (exclusive)
	approvedTag string    // "2006-01" — compared against module12 ApprovedPeriodWIB
	id          string    // "200601" — CHR- id month bucket
}

// monthPeriod builds the period for the WIB calendar month that contains anchor.
func monthPeriod(anchor time.Time) period {
	w := anchor.In(tz.WIB)
	start := time.Date(w.Year(), w.Month(), 1, 0, 0, 0, 0, tz.WIB)
	next := start.AddDate(0, 1, 0)
	last := next.AddDate(0, 0, -1)
	return period{
		start:       start,
		startDate:   start.Format("2006-01-02"),
		endDate:     last.Format("2006-01-02"),
		startUTC:    start.UTC(),
		endUTC:      next.UTC(),
		approvedTag: start.Format("2006-01"),
		id:          start.Format("200601"),
	}
}

// closedMonthPeriod is the most-recently CLOSED calendar month relative to now
// (WIB) — i.e. the previous month. The monthly batch scores exactly this period
// (M13 §3 / §5.2: "at each month boundary … pulls closed-period data").
func closedMonthPeriod(now time.Time) period {
	thisMonthStart := monthPeriod(now).start
	return monthPeriod(thisMonthStart.AddDate(0, 0, -1))
}

// clientInputs is the row-level Client data every component draws from.
type clientInputs struct {
	baselineCents float64
	targetCents   float64
	currentCents  float64
	createdAt     time.Time
	roasOverride  sql.NullBool // NULL = follow default; else explicit toggle
}

// loadClientInputs reads the Client's GMV numbers, onboarding timestamp and ROAS
// override in one query. Returns ErrNotFound when the client is absent.
func loadClientInputs(ctx context.Context, q rowQuerier, clientID string) (clientInputs, error) {
	var baseline, target, current string
	var createdAt time.Time
	var override sql.NullBool
	err := q.QueryRowContext(ctx,
		`SELECT gmv_baseline, target_gmv, total_sales, created_at, roas_health_included_override
		   FROM clients WHERE id = ?`, clientID).
		Scan(&baseline, &target, &current, &createdAt, &override)
	if errors.Is(err, sql.ErrNoRows) {
		return clientInputs{}, ErrNotFound
	}
	if err != nil {
		return clientInputs{}, err
	}
	b, err := money.Parse(baseline)
	if err != nil {
		return clientInputs{}, err
	}
	t, err := money.Parse(target)
	if err != nil {
		return clientInputs{}, err
	}
	c, err := money.Parse(current)
	if err != nil {
		return clientInputs{}, err
	}
	return clientInputs{
		baselineCents: float64(b),
		targetCents:   float64(t),
		currentCents:  float64(c),
		createdAt:     createdAt,
		roasOverride:  override,
	}, nil
}

// firstFullMonthStart is the WIB first-of-month of the Client's first FULL
// calendar month (Rule 8 grace). A Client onboarded on day 1 has that month as
// its first full month; onboarded mid-month, the following month.
func firstFullMonthStart(createdAt time.Time) time.Time {
	w := createdAt.In(tz.WIB)
	monthStart := time.Date(w.Year(), w.Month(), 1, 0, 0, 0, 0, tz.WIB)
	if w.Day() == 1 {
		return monthStart
	}
	return monthStart.AddDate(0, 1, 0)
}

// gatherComponents assembles the seven component candidates for one Client and
// period, plus the effective ROAS-inclusion toggle state recorded on the
// snapshot (Rule 13 / §5.1). It is the single source of truth shared by the batch
// sweep, the get, and the live preview.
func (s *Service) gatherComponents(ctx context.Context, q rowQuerier, clientID string, per period) ([]candidate, bool, error) {
	ci, err := loadClientInputs(ctx, q, clientID)
	if err != nil {
		return nil, false, err
	}

	cands := make([]candidate, 0, 7)

	// --- GMV Growth (Module 4) — Rule 5 + grace Rule 8 ---
	grace := !per.start.After(firstFullMonthStart(ci.createdAt))
	cands = append(cands, gmvCandidate(ci, grace))

	// --- ROAS Attainment (Module 8) — Rule 5 + toggle Rule 13 ---
	roasCand, roasState, err := s.roasCandidate(ctx, q, clientID, per, ci.roasOverride)
	if err != nil {
		return nil, false, err
	}
	cands = append(cands, roasCand)

	// --- Task Completion + Revision Burden (Module 12) — Rule 5 ---
	taskCand, revCand, err := s.taskCandidates(ctx, q, clientID, per)
	if err != nil {
		return nil, false, err
	}
	cands = append(cands, taskCand, revCand)

	// --- Complaints (Module 6) — Rule 5 (always available; 0 complaints = 100) ---
	complCand, err := complaintsCandidate(ctx, q, clientID, per)
	if err != nil {
		return nil, false, err
	}
	cands = append(cands, complCand)

	// --- Satisfaction — ALWAYS N/A until Module 15 (Rule 2 / §5.5). Never proxied. ---
	cands = append(cands, candidate{
		name: CompSatisfaction, included: false,
		reason: "placeholder — Module 15 (CSAT/Client Portal) belum ada",
	})

	// --- Payment Timeliness (Module 5) — Rule 5 ---
	payCand, err := paymentCandidate(ctx, q, clientID, per)
	if err != nil {
		return nil, false, err
	}
	cands = append(cands, payCand)

	return cands, roasState, nil
}

// gmvCandidate implements GMV Growth (Rule 5): (Current−Baseline)/(Target−Baseline)×100.
// Excluded during the first-full-month grace (Rule 8) or when Target==Baseline
// (zero denominator → excluded + redistributed, not an error; decision point 6).
func gmvCandidate(ci clientInputs, grace bool) candidate {
	if grace {
		return candidate{name: CompGMVGrowth, included: false,
			reason: "grace period klien baru — GMV Growth dikecualikan pada bulan penuh pertama (Rule 8)"}
	}
	denom := ci.targetCents - ci.baselineCents
	if denom == 0 {
		return candidate{name: CompGMVGrowth, included: false,
			reason: "Target GMV sama dengan Baseline GMV — pembagi nol, dikecualikan + bobot didistribusi ulang"}
	}
	raw := (ci.currentCents - ci.baselineCents) / denom * 100
	return candidate{name: CompGMVGrowth, included: true, raw: raw}
}

// roasCandidate implements ROAS Attainment (Rule 5) with the toggle (Rule 13).
// Returns the candidate and the EFFECTIVE toggle state persisted on the snapshot.
//
// Effective inclusion = hasAnyAds && coalesce(override, hasActiveAds):
//   - No Ads campaign at all → structurally N/A regardless of toggle (Rule 13).
//   - Explicit override present → obey it (team toggled ON/OFF).
//   - Otherwise default = the Client has an ACTIVE ([Active]) campaign (Rule 13
//     "included by default whenever the Client has an active Ads service").
//
// Even when included, no metric data in the period (Σ spend == 0) or no parseable
// ROAS target excludes it as a missing-data case (decision points 2 & 6).
func (s *Service) roasCandidate(ctx context.Context, q rowQuerier, clientID string, per period, override sql.NullBool) (candidate, bool, error) {
	hasAny, hasActive, err := adsServicePresence(ctx, q, clientID)
	if err != nil {
		return candidate{}, false, err
	}
	if !hasAny {
		// No Ads service at all — structurally N/A (Rule 13). Toggle irrelevant.
		return candidate{name: CompROASAttainment, included: false,
			reason: "klien tidak memiliki layanan Ads — ROAS N/A struktural (Rule 13)"}, false, nil
	}
	toggleOn := hasActive
	if override.Valid {
		toggleOn = override.Bool
	}
	if !toggleOn {
		return candidate{name: CompROASAttainment, included: false,
			reason: "ROAS dimatikan oleh toggle tim (Rule 13)"}, false, nil
	}

	curROAS, hasData, err := currentPeriodROAS(ctx, q, clientID, per)
	if err != nil {
		return candidate{}, false, err
	}
	if !hasData {
		return candidate{name: CompROASAttainment, included: false,
			reason: "tidak ada data metrik ROAS pada periode — dikecualikan + bobot didistribusi ulang"}, true, nil
	}
	target, hasTarget, err := aggregateTargetROAS(ctx, q, clientID)
	if err != nil {
		return candidate{}, false, err
	}
	if !hasTarget {
		return candidate{name: CompROASAttainment, included: false,
			reason: "target ROAS tidak dapat diparse dari Target KPI — dikecualikan + bobot didistribusi ulang"}, true, nil
	}
	raw := curROAS / target * 100
	return candidate{name: CompROASAttainment, included: true, raw: raw}, true, nil
}

// adsServicePresence reports whether the Client has ANY ad campaign, and whether
// it has an ACTIVE one — the two signals the toggle default (Rule 13) needs.
func adsServicePresence(ctx context.Context, q rowQuerier, clientID string) (hasAny, hasActive bool, err error) {
	var anyN, activeN int
	err = q.QueryRowContext(ctx,
		`SELECT COUNT(*), SUM(status = ?) FROM ad_campaigns WHERE client_id = ?`,
		adCampaignActiveStatus, clientID).Scan(&anyN, &sqlNullToInt{&activeN})
	if err != nil {
		return false, false, err
	}
	return anyN > 0, activeN > 0, nil
}

// currentPeriodROAS = ΣGMV / ΣSpend over the Client's Metric Entries whose period
// starts within the snapshot month (aggregated across ALL the Client's campaigns,
// decision point 2). hasData=false when there is no spend to divide by (Σ==0).
func currentPeriodROAS(ctx context.Context, q rowQuerier, clientID string, per period) (float64, bool, error) {
	var spend, gmv sql.NullString
	err := q.QueryRowContext(ctx,
		`SELECT SUM(m.spend), SUM(m.gmv)
		   FROM metric_entries m JOIN ad_campaigns c ON c.id = m.campaign_id
		  WHERE c.client_id = ? AND m.period_start BETWEEN ? AND ?`,
		clientID, per.startDate, per.endDate).Scan(&spend, &gmv)
	if err != nil {
		return 0, false, err
	}
	if !spend.Valid || !gmv.Valid {
		return 0, false, nil
	}
	sp, err := money.Parse(spend.String)
	if err != nil {
		return 0, false, err
	}
	gm, err := money.Parse(gmv.String)
	if err != nil {
		return 0, false, err
	}
	if sp == 0 {
		return 0, false, nil // div-zero → treated as missing data (house rule 7)
	}
	return float64(gm) / float64(sp), true, nil
}

// aggregateTargetROAS parses each of the Client's campaigns' Target KPI (free
// text) via module8_ads' proven parser and returns the MEAN of the parseable
// ROAS targets (decision point 2). hasTarget=false when none parse — treated as
// missing data (decision point 2, mirrors module8_ads' no-false-escalation rule).
func aggregateTargetROAS(ctx context.Context, q rowQuerier, clientID string) (float64, bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT target_kpi FROM ad_campaigns WHERE client_id = ?`, clientID)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()
	var sum float64
	var n int
	for rows.Next() {
		var kpi string
		if err := rows.Scan(&kpi); err != nil {
			return 0, false, err
		}
		if v, ok := module8_ads.ParseROASTarget(kpi); ok {
			sum += v
			n++
		}
	}
	if err := rows.Err(); err != nil {
		return 0, false, err
	}
	if n == 0 {
		return 0, false, nil
	}
	return sum / float64(n), true, nil
}

// taskCandidates computes Task Completion Rate and Revision Burden (Module 12,
// Rule 5) over the Client's canonical Tasks that reached [Approved] IN the period.
//
//   - Task Completion = % of period-approved Tasks WITH an SLA whose Speed Score
//     ≤ 100% (within SLA). Tasks without an SLA can't be judged and are excluded
//     from the ratio; if none had an SLA, the component is excluded (redistribute).
//   - Revision Burden = 100 − min(avg Revision Count × 20, 100), over the same
//     period-approved set; excluded when no Task closed in the period.
//
// Every metric is recomputed from the immutable transition log (house rule 4) via
// module12_task.ComputeMappedMetrics — the same pure core M12 uses.
func (s *Service) taskCandidates(ctx context.Context, q rowQuerier, clientID string, per period) (candidate, candidate, error) {
	type taskRow struct {
		entityType string
		id         string
		sla        *float64
	}
	var tasks []taskRow

	// Creative Assets of the Client (asset entities).
	aRows, err := q.QueryContext(ctx,
		`SELECT a.id, a.sla_target_hours
		   FROM assets a
		   JOIN briefs b ON b.id = a.brief_id
		   JOIN services sv ON sv.id = b.service_id
		  WHERE sv.client_id = ?`, clientID)
	if err != nil {
		return candidate{}, candidate{}, err
	}
	for aRows.Next() {
		var tr taskRow
		var sla sql.NullFloat64
		if err := aRows.Scan(&tr.id, &sla); err != nil {
			aRows.Close()
			return candidate{}, candidate{}, err
		}
		tr.entityType = "asset"
		tr.sla = nullFloatPtr(sla)
		tasks = append(tasks, tr)
	}
	if err := aRows.Err(); err != nil {
		aRows.Close()
		return candidate{}, candidate{}, err
	}
	aRows.Close()

	// Ads Briefs-as-task of the Client.
	bRows, err := q.QueryContext(ctx,
		`SELECT b.id, b.sla_target_hours
		   FROM briefs b
		   JOIN services sv ON sv.id = b.service_id
		  WHERE sv.client_id = ? AND b.assigned_division = ?`, clientID, adsBriefDivision)
	if err != nil {
		return candidate{}, candidate{}, err
	}
	for bRows.Next() {
		var tr taskRow
		var sla sql.NullFloat64
		if err := bRows.Scan(&tr.id, &sla); err != nil {
			bRows.Close()
			return candidate{}, candidate{}, err
		}
		tr.entityType = "brief"
		tr.sla = nullFloatPtr(sla)
		tasks = append(tasks, tr)
	}
	if err := bRows.Err(); err != nil {
		bRows.Close()
		return candidate{}, candidate{}, err
	}
	bRows.Close()

	var approvedInPeriod int // denominator for Revision Burden
	var slaJudged int        // denominator for Task Completion (has SLA)
	var withinSLA int        // numerator for Task Completion
	var revisionSum int      // for the average revision count

	for _, tr := range tasks {
		transitions, err := taskTransitions(ctx, q, tr.entityType, tr.id)
		if err != nil {
			return candidate{}, candidate{}, err
		}
		m := module12_task.ComputeMappedMetrics(transitions, tr.sla)
		if m.ApprovedPeriodWIB != per.approvedTag {
			continue // not closed in this period
		}
		approvedInPeriod++
		revisionSum += m.RevisionCount
		if m.SpeedScorePct != nil { // has an SLA and is judged
			slaJudged++
			if *m.SpeedScorePct <= 100 {
				withinSLA++
			}
		}
	}

	var taskCand candidate
	if slaJudged == 0 {
		taskCand = candidate{name: CompTaskCompletion, included: false,
			reason: "tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang"}
	} else {
		taskCand = candidate{name: CompTaskCompletion, included: true,
			raw: float64(withinSLA) / float64(slaJudged) * 100}
	}

	var revCand candidate
	if approvedInPeriod == 0 {
		revCand = candidate{name: CompRevisionBurden, included: false,
			reason: "tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang"}
	} else {
		avgRev := float64(revisionSum) / float64(approvedInPeriod)
		burden := 100 - minFloat(avgRev*20, 100)
		revCand = candidate{name: CompRevisionBurden, included: true, raw: burden}
	}
	return taskCand, revCand, nil
}

// taskTransitions reads a canonical Task's immutable transition log and maps it
// to module12_task.Transition (destination label + timestamp), ASCENDING. Mirrors
// module12_task.parseTransitions (audit.List is DESC, so we reverse).
func taskTransitions(ctx context.Context, q rowQuerier, entityType, id string) ([]module12_task.Transition, error) {
	entries, err := audit.List(ctx, q, audit.Filter{EntityType: entityType, EntityID: id})
	if err != nil {
		return nil, err
	}
	out := make([]module12_task.Transition, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		to, ok := transitionTarget(entries[i].Action)
		if !ok {
			continue
		}
		out = append(out, module12_task.Transition{To: to, At: entries[i].CreatedAt})
	}
	return out, nil
}

// transitionTarget extracts B from a "transition:A->B" audit action (mirrors
// module12_task.transitionTarget, unexported there).
func transitionTarget(action string) (string, bool) {
	const prefix = "transition:"
	if !strings.HasPrefix(action, prefix) {
		return "", false
	}
	rest := action[len(prefix):]
	idx := strings.Index(rest, "->")
	if idx < 0 {
		return "", false
	}
	return rest[idx+2:], true
}

// complaintsCandidate implements Complaints (Rule 5): 100 − Σ severity penalty,
// floored at 0 (the [0,100] cap does the floor). Complaints logged in the period
// = complaints created within the WIB month window. Always available — zero
// complaints yields a clean 100 (never excluded).
func complaintsCandidate(ctx context.Context, q rowQuerier, clientID string, per period) (candidate, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT severity FROM complaints
		   WHERE client_id = ? AND created_at >= ? AND created_at < ?`,
		clientID, per.startUTC, per.endUTC)
	if err != nil {
		return candidate{}, err
	}
	defer rows.Close()
	var penalty float64
	for rows.Next() {
		var sev string
		if err := rows.Scan(&sev); err != nil {
			return candidate{}, err
		}
		switch sev {
		case "Low":
			penalty += penaltyLow
		case "Medium":
			penalty += penaltyMedium
		case "High":
			penalty += penaltyHigh
		}
	}
	if err := rows.Err(); err != nil {
		return candidate{}, err
	}
	return candidate{name: CompComplaints, included: true, raw: 100 - penalty}, nil
}

// paymentCandidate implements Payment Timeliness (Rule 5): % of Installments due
// in the period that never triggered [Jatuh Tempo]. "Due in the period" =
// due_date within the WIB month (decision point 5). "Never triggered [Jatuh
// Tempo]" is recomputed from the immutable transition log (house rule 4): an
// installment with any transition INTO [Jatuh Tempo] broke timeliness. Excluded
// (redistribute) when no installment was due in the period.
func paymentCandidate(ctx context.Context, q rowQuerier, clientID string, per period) (candidate, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT i.id FROM installments i
		   JOIN transactions t ON t.id = i.transaction_id
		  WHERE t.client_id = ? AND i.due_date IS NOT NULL
		    AND i.due_date BETWEEN ? AND ?`,
		clientID, per.startDate, per.endDate)
	if err != nil {
		return candidate{}, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return candidate{}, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return candidate{}, err
	}
	rows.Close()

	if len(ids) == 0 {
		return candidate{name: CompPaymentTimeliness, included: false,
			reason: "tidak ada tagihan jatuh tempo pada periode — dikecualikan + bobot didistribusi ulang"}, nil
	}
	var overdue int
	for _, id := range ids {
		triggered, err := installmentEverOverdue(ctx, q, id)
		if err != nil {
			return candidate{}, err
		}
		if triggered {
			overdue++
		}
	}
	timely := len(ids) - overdue
	return candidate{name: CompPaymentTimeliness, included: true,
		raw: float64(timely) / float64(len(ids)) * 100}, nil
}

// installmentEverOverdue reports whether an installment ever transitioned INTO
// [Jatuh Tempo], from its immutable audit log (house rule 4).
func installmentEverOverdue(ctx context.Context, q rowQuerier, instID string) (bool, error) {
	entries, err := audit.List(ctx, q, audit.Filter{EntityType: "installment", EntityID: instID})
	if err != nil {
		return false, err
	}
	for _, e := range entries {
		if to, ok := transitionTarget(e.Action); ok && to == installmentOverdueStatus {
			return true, nil
		}
	}
	return false, nil
}

// --- small helpers ---

func nullFloatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// sqlNullToInt lets SUM(bool) (which is NULL for zero rows) scan into an int as 0.
type sqlNullToInt struct{ dst *int }

func (s *sqlNullToInt) Scan(v any) error {
	if v == nil {
		*s.dst = 0
		return nil
	}
	switch t := v.(type) {
	case int64:
		*s.dst = int(t)
	case []byte:
		n := 0
		for _, c := range t {
			if c >= '0' && c <= '9' {
				n = n*10 + int(c-'0')
			}
		}
		*s.dst = n
	}
	return nil
}
