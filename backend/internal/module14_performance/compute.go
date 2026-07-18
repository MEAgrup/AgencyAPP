package module14_performance

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module8_ads"
	"github.com/meagrup/agencyapp/backend/internal/module9_kol"
)

// This file gathers the per-role RAW KPI inputs from the source modules (M7/M8/
// M9/M12) for one staff member and period, turning them into scoreProfile
// candidates. Every value is recomputed from the immutable event/timestamp logs
// (house rule 4). The interpretation of each raw KPI is documented at its gatherer
// and in the cluster report (decision point 2).
//
// The Ads Brief-as-task division label; Creative work is scored via its Assets.
const (
	adsBriefDivision = "Ads"

	// revisionInverseFactor mirrors Module 13's Revision Burden transform
	// (100 − min(avg × 20, 100)) so a Revision Count sub-score is comparable across
	// the two modules (decision point 2). avg 0 → 100; avg 5+ → 0.
	revisionInverseFactor = 20
)

// period is one scored WIB calendar month (O20), carrying the bounds the gatherers
// need. Mirrors module13_health.period.
type period struct {
	start       time.Time // WIB midnight, first day of month
	startDate   string    // "2006-01-02"
	endDate     string    // last day, "2006-01-02" (inclusive DATE upper bound)
	startUTC    time.Time // start instant UTC (inclusive)
	endUTC      time.Time // next-month start UTC (exclusive)
	approvedTag string    // "2006-01" — compared against module12 ApprovedPeriodWIB
	id          string    // "200601" — id-bucket
}

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

// closedMonthPeriod is the most-recently CLOSED WIB calendar month (previous
// month) — the month the monthly batch scores (§5.4, same as Module 13).
func closedMonthPeriod(now time.Time) period {
	return monthPeriod(monthPeriod(now).start.AddDate(0, 0, -1))
}

// gatherProfile assembles the weighted (+ diagnostic) candidates for one staff
// member's role type and period. It dispatches to the per-role gatherer. anyPlaceholder
// reports whether any raw-value normalisation fell back to a placeholder target
// (O9) — surfaced on the snapshot so an unconfirmed target is never mistaken for a
// real one.
func (s *Service) gatherProfile(ctx context.Context, q rowQuerier, staffID, roleType string, per period) (cands []candidate, anyPlaceholder bool, err error) {
	pt := &placeholderTracker{}
	switch roleType {
	case RoleCreative:
		cands, err = s.creativeCandidates(ctx, q, staffID, per, pt)
	case RoleAds:
		cands, err = s.adsCandidates(ctx, q, staffID, per, pt)
	case RoleKOL:
		cands, err = s.kolCandidates(ctx, q, staffID, per, pt)
	case RoleAM:
		cands, err = s.amCandidates(ctx, q, staffID, per, pt)
	default:
		return nil, false, nil
	}
	return cands, pt.used, err
}

// placeholderTracker records whether any target lookup returned a placeholder.
type placeholderTracker struct{ used bool }

// normalized builds a raw-value candidate normalized as Actual ÷ Period Target ×
// 100 (OA-2; the cap to 100 is applied later by scoreProfile.clamp01to100). When no
// target is configured the component is excluded + redistributed (decision point
// 2/4). notPresentReason is used when the actual is structurally absent (e.g. no
// approved output at all).
func (s *Service) normalized(ctx context.Context, q rowQuerier, roleType, comp string, per period, actual float64, hasActual bool, absentReason string, pt *placeholderTracker) (candidate, error) {
	if !hasActual {
		return candidate{name: comp, included: false, reason: absentReason}, nil
	}
	target, placeholder, ok, err := targetFor(ctx, q, roleType, comp, per.startDate)
	if err != nil {
		return candidate{}, err
	}
	if !ok || target == 0 {
		return candidate{name: comp, included: false,
			reason: "target periode belum dikonfigurasi (O9) — dikecualikan + bobot didistribusi ulang"}, nil
	}
	if placeholder {
		pt.used = true
	}
	return candidate{name: comp, included: true, raw: actual / target * 100}, nil
}

// ---- Creative (staff = assets.assigned_pic) ----

func (s *Service) creativeCandidates(ctx context.Context, q rowQuerier, staffID string, per period, pt *placeholderTracker) ([]candidate, error) {
	// Every Creative Asset assigned to this staff member.
	rows, err := q.QueryContext(ctx,
		`SELECT id, sla_target_hours, attributed_gmv FROM assets WHERE assigned_pic = ?`, staffID)
	if err != nil {
		return nil, err
	}
	type assetRow struct {
		id  string
		sla *float64
		gmv float64
	}
	var assets []assetRow
	for rows.Next() {
		var ar assetRow
		var sla sql.NullFloat64
		var gmv sql.NullString
		if err := rows.Scan(&ar.id, &sla, &gmv); err != nil {
			rows.Close()
			return nil, err
		}
		ar.sla = nullFloatPtr(sla)
		if gmv.Valid {
			if v, e := money.Parse(gmv.String); e == nil {
				ar.gmv = float64(v) / 100
			}
		}
		assets = append(assets, ar)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var approvedInPeriod, slaJudged int
	var speedSum, revisionSum, gmvSum float64
	for _, ar := range assets {
		m, err := s.assetMetrics(ctx, q, ar.id, ar.sla)
		if err != nil {
			return nil, err
		}
		if m.ApprovedPeriodWIB != per.approvedTag {
			continue
		}
		approvedInPeriod++
		revisionSum += float64(m.RevisionCount)
		gmvSum += ar.gmv
		if m.SpeedScorePct != nil {
			slaJudged++
			speedSum += *m.SpeedScorePct
		}
	}

	cands := make([]candidate, 0, 4)
	cands = append(cands, speedCandidate(speedSum, slaJudged))
	// Output Quantity = approved assets in period, normalized to target.
	oq, err := s.normalized(ctx, q, RoleCreative, CompOutputQuantity, per, float64(approvedInPeriod), true,
		"", pt)
	if err != nil {
		return nil, err
	}
	cands = append(cands, oq)
	// GMV Impact = Σ attributed_gmv over period-approved assets, normalized. Absent
	// (no approved output) → excluded.
	gmv, err := s.normalized(ctx, q, RoleCreative, CompGMVImpact, per, gmvSum, approvedInPeriod > 0,
		"tidak ada Asset [Approved] pada periode — GMV Impact dikecualikan + bobot didistribusi ulang", pt)
	if err != nil {
		return nil, err
	}
	cands = append(cands, gmv)
	cands = append(cands, revisionCandidate(revisionSum, approvedInPeriod))
	return cands, nil
}

// ---- Ads (staff = setup Brief.assigned_pic; optimizations by actor) ----

func (s *Service) adsCandidates(ctx context.Context, q rowQuerier, staffID string, per period, pt *placeholderTracker) ([]candidate, error) {
	// Ads Briefs-as-task assigned to this advertiser → Speed Score.
	bRows, err := q.QueryContext(ctx,
		`SELECT id, sla_target_hours FROM briefs WHERE assigned_pic = ? AND assigned_division = ?`,
		staffID, adsBriefDivision)
	if err != nil {
		return nil, err
	}
	type briefRow struct {
		id  string
		sla *float64
	}
	var briefs []briefRow
	for bRows.Next() {
		var br briefRow
		var sla sql.NullFloat64
		if err := bRows.Scan(&br.id, &sla); err != nil {
			bRows.Close()
			return nil, err
		}
		br.sla = nullFloatPtr(sla)
		briefs = append(briefs, br)
	}
	if err := bRows.Err(); err != nil {
		bRows.Close()
		return nil, err
	}
	bRows.Close()

	var slaJudged int
	var speedSum float64
	for _, br := range briefs {
		m, err := s.briefMetrics(ctx, q, br.id, br.sla)
		if err != nil {
			return nil, err
		}
		if m.ApprovedPeriodWIB != per.approvedTag || m.SpeedScorePct == nil {
			continue
		}
		slaJudged++
		speedSum += *m.SpeedScorePct
	}

	// ROAS Attainment + GMV Impact from the staff's managed campaigns (setup brief
	// assigned_pic = staff).
	roasRaw, hasROAS, gmvSum, hasCampaigns, err := s.adsCampaignMetrics(ctx, q, staffID, per)
	if err != nil {
		return nil, err
	}
	// Optimization Activity = optimizations this staff logged in the period.
	var optCount int
	if err := q.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM optimization_logs WHERE actor = ? AND created_at >= ? AND created_at < ?`,
		staffID, per.startUTC, per.endUTC).Scan(&optCount); err != nil {
		return nil, err
	}

	cands := make([]candidate, 0, 4)
	cands = append(cands, speedCandidate(speedSum, slaJudged))
	if hasROAS {
		cands = append(cands, candidate{name: CompROASAttainment, included: true, raw: roasRaw})
	} else {
		cands = append(cands, candidate{name: CompROASAttainment, included: false,
			reason: "tidak ada data ROAS/target pada campaign yang dikelola periode ini — dikecualikan + bobot didistribusi ulang"})
	}
	gmv, err := s.normalized(ctx, q, RoleAds, CompGMVImpact, per, gmvSum, hasCampaigns,
		"tidak ada campaign yang dikelola pada periode — GMV Impact dikecualikan + bobot didistribusi ulang", pt)
	if err != nil {
		return nil, err
	}
	cands = append(cands, gmv)
	opt, err := s.normalized(ctx, q, RoleAds, CompOptimizationActivity, per, float64(optCount), true, "", pt)
	if err != nil {
		return nil, err
	}
	cands = append(cands, opt)
	return cands, nil
}

// adsCampaignMetrics folds the staff's managed campaigns into a single ROAS
// Attainment sub-score (mean of per-campaign period-ROAS ÷ target-ROAS × 100) and
// the Σ period GMV. hasROAS is false when no managed campaign had BOTH period spend
// and a parseable ROAS target. hasCampaigns is false when the staff manages none.
func (s *Service) adsCampaignMetrics(ctx context.Context, q rowQuerier, staffID string, per period) (roasRaw float64, hasROAS bool, gmvSum float64, hasCampaigns bool, err error) {
	rows, err := q.QueryContext(ctx,
		`SELECT c.id, c.target_kpi
		   FROM ad_campaigns c
		   JOIN briefs b ON b.id = c.brief_id
		  WHERE b.assigned_pic = ?`, staffID)
	if err != nil {
		return 0, false, 0, false, err
	}
	type camp struct {
		id     string
		target string
	}
	var camps []camp
	for rows.Next() {
		var c camp
		if err := rows.Scan(&c.id, &c.target); err != nil {
			rows.Close()
			return 0, false, 0, false, err
		}
		camps = append(camps, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, false, 0, false, err
	}
	rows.Close()
	if len(camps) == 0 {
		return 0, false, 0, false, nil
	}
	hasCampaigns = true

	var ratioSum float64
	var ratioN int
	for _, c := range camps {
		spend, gmv, hasData, err := campaignPeriodSpendGMV(ctx, q, c.id, per)
		if err != nil {
			return 0, false, 0, false, err
		}
		if hasData {
			gmvSum += gmv // rupiah
		}
		if !hasData || spend == 0 {
			continue
		}
		target, ok := module8_ads.ParseROASTarget(c.target)
		if !ok {
			continue
		}
		periodROAS := gmv / spend
		ratioSum += periodROAS / target * 100
		ratioN++
	}
	if ratioN > 0 {
		roasRaw = ratioSum / float64(ratioN)
		hasROAS = true
	}
	return roasRaw, hasROAS, gmvSum, hasCampaigns, nil
}

// campaignPeriodSpendGMV = Σ spend / Σ gmv (rupiah) over the campaign's Metric
// Entries whose period_start falls in the snapshot month. hasData=false when the
// campaign has no metric row in the period.
func campaignPeriodSpendGMV(ctx context.Context, q rowQuerier, campaignID string, per period) (spend, gmv float64, hasData bool, err error) {
	var sp, gm sql.NullString
	err = q.QueryRowContext(ctx,
		`SELECT SUM(spend), SUM(gmv) FROM metric_entries
		   WHERE campaign_id = ? AND period_start BETWEEN ? AND ?`,
		campaignID, per.startDate, per.endDate).Scan(&sp, &gm)
	if err != nil {
		return 0, 0, false, err
	}
	if !sp.Valid || !gm.Valid {
		return 0, 0, false, nil
	}
	spCents, err := money.Parse(sp.String)
	if err != nil {
		return 0, 0, false, err
	}
	gmCents, err := money.Parse(gm.String)
	if err != nil {
		return 0, 0, false, err
	}
	return float64(spCents) / 100, float64(gmCents) / 100, true, nil
}

// ---- KOL (staff = creator_bookings.assigned_coordinator) ----

func (s *Service) kolCandidates(ctx context.Context, q rowQuerier, staffID string, per period, pt *placeholderTracker) ([]candidate, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, status, created_at, sla_target_hours FROM creator_bookings WHERE assigned_coordinator = ?`,
		staffID)
	if err != nil {
		return nil, err
	}
	type bkgRow struct {
		id        string
		status    string
		createdAt time.Time
		sla       *float64
	}
	var bookings []bkgRow
	for rows.Next() {
		var b bkgRow
		var sla sql.NullFloat64
		if err := rows.Scan(&b.id, &b.status, &b.createdAt, &sla); err != nil {
			rows.Close()
			return nil, err
		}
		b.sla = nullFloatPtr(sla)
		bookings = append(bookings, b)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var passedInPeriod, qcActivity, escalations, terminalActivity int
	var speedSum float64
	var speedN int
	var sourcingSum float64
	var sourcingN int
	for _, b := range bookings {
		entries, err := audit.List(ctx, q, audit.Filter{EntityType: "creator_booking", EntityID: b.id})
		if err != nil {
			return nil, err
		}
		m := module9_kol.ComputeBookingMetricsFromLog(b.id, b.status, b.createdAt, b.sla, entries)
		// QC-passed in period: Creator Count + Speed Score + terminal activity.
		if m.ApprovedPeriodWIB == per.approvedTag {
			passedInPeriod++
			qcActivity++
			terminalActivity++
			if m.SpeedScorePct != nil {
				speedSum += *m.SpeedScorePct
				speedN++
			}
			if m.SourcingTurnaroundHours != nil {
				sourcingSum += *m.SourcingTurnaroundHours
				sourcingN++
			}
		}
		// QC failures + escalations occurring in the period (recompute from log).
		qcFailed := transitionCountInPeriod(entries, module9_kol.BkgQCFailed, per)
		esc := transitionCountInPeriod(entries, module9_kol.BkgEscalated, per)
		qcActivity += qcFailed
		if esc > 0 {
			escalations++
			terminalActivity++
		}
	}

	cands := make([]candidate, 0, 5)
	// Creator Count = QC-passed bookings in period, normalized to target.
	cc, err := s.normalized(ctx, q, RoleKOL, CompCreatorCount, per, float64(passedInPeriod), true, "", pt)
	if err != nil {
		return nil, err
	}
	cands = append(cands, cc)
	// QC Pass Rate = passed ÷ (passed + failed events) in period.
	if qcActivity == 0 {
		cands = append(cands, candidate{name: CompQCPassRate, included: false,
			reason: "tidak ada aktivitas QC pada periode — dikecualikan + bobot didistribusi ulang"})
	} else {
		cands = append(cands, candidate{name: CompQCPassRate, included: true,
			raw: float64(passedInPeriod) / float64(qcActivity) * 100})
	}
	// Speed Score (combined Sourcing+Delivery vs SLA), transform OA-1.
	cands = append(cands, speedCandidate(speedSum, speedN))
	// Escalation Rate (inverse): 100 − escalated ÷ terminal-activity × 100.
	if terminalActivity == 0 {
		cands = append(cands, candidate{name: CompEscalationRate, included: false,
			reason: "tidak ada booking terminal (QC Passed/Escalated) pada periode — dikecualikan + bobot didistribusi ulang"})
	} else {
		cands = append(cands, candidate{name: CompEscalationRate, included: true,
			raw: 100 - float64(escalations)/float64(terminalActivity)*100})
	}
	// Sourcing Turnaround — DIAGNOSTIC (reported, unweighted; §2 Rule 2 KOL row).
	if sourcingN == 0 {
		cands = append(cands, candidate{name: CompSourcingTurnaround, diagnostic: true, included: false,
			reason: "tidak ada booking [Booked] pada periode — turnaround sourcing tidak tersedia"})
	} else {
		cands = append(cands, candidate{name: CompSourcingTurnaround, diagnostic: true, included: true,
			raw: sourcingSum / float64(sourcingN)})
	}
	return cands, nil
}

// ---- AM (staff = clients.assigned_am_id) ----

func (s *Service) amCandidates(ctx context.Context, q rowQuerier, staffID string, per period, pt *placeholderTracker) ([]candidate, error) {
	// Portfolio clients.
	cRows, err := q.QueryContext(ctx, `SELECT id FROM clients WHERE assigned_am_id = ?`, staffID)
	if err != nil {
		return nil, err
	}
	var clientIDs []string
	for cRows.Next() {
		var id string
		if err := cRows.Scan(&id); err != nil {
			cRows.Close()
			return nil, err
		}
		clientIDs = append(clientIDs, id)
	}
	if err := cRows.Err(); err != nil {
		cRows.Close()
		return nil, err
	}
	cRows.Close()

	cands := make([]candidate, 0, 3)

	// CHR Average (M13 §8/OA-6): mean final_health_score over the portfolio's CHR
	// snapshots for the SAME period.
	var chrSum float64
	var chrN int
	for _, cid := range clientIDs {
		var score sql.NullFloat64
		err := q.QueryRowContext(ctx,
			`SELECT final_health_score FROM client_health_snapshots WHERE client_id = ? AND period_start = ?`,
			cid, per.startDate).Scan(&score)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		if score.Valid {
			chrSum += score.Float64
			chrN++
		}
	}
	if chrN == 0 {
		cands = append(cands, candidate{name: CompCHRAverage, included: false,
			reason: "tidak ada snapshot Client Health untuk portofolio pada periode — dikecualikan + bobot didistribusi ulang"})
	} else {
		cands = append(cands, candidate{name: CompCHRAverage, included: true, raw: chrSum / float64(chrN)})
	}

	// Complaint Resolution Speed: avg resolution hours over complaints assigned to
	// the AM that reached [Resolved] in the period, transformed OA-1 against the
	// configurable resolution-SLA target (hours).
	avgResHours, hasRes, err := amResolutionHours(ctx, q, staffID, per)
	if err != nil {
		return nil, err
	}
	cands = append(cands, s.complaintResolutionCandidate(ctx, q, avgResHours, hasRes, per, pt))

	// Revision Escalation Rate (inverse): fraction of the portfolio's period-approved
	// Tasks that were revision-flagged (≥3 revisions, M12 Rule 15).
	revCand, err := s.amRevisionEscalation(ctx, q, clientIDs, per)
	if err != nil {
		return nil, err
	}
	cands = append(cands, revCand)
	return cands, nil
}

// complaintResolutionCandidate normalizes average resolution hours via the OA-1
// Speed transform against the configurable resolution-SLA target. Faster than SLA
// → 100; slower → 200 − (avg/target×100), floored at 0.
func (s *Service) complaintResolutionCandidate(ctx context.Context, q rowQuerier, avgHours float64, hasRes bool, per period, pt *placeholderTracker) candidate {
	if !hasRes {
		return candidate{name: CompComplaintResolutionSpeed, included: false,
			reason: "tidak ada komplain yang selesai [Resolved] pada periode — dikecualikan + bobot didistribusi ulang"}
	}
	target, placeholder, ok, err := targetFor(ctx, q, RoleAM, CompComplaintResolutionSpeed, per.startDate)
	if err != nil || !ok || target == 0 {
		return candidate{name: CompComplaintResolutionSpeed, included: false,
			reason: "target SLA resolusi komplain belum dikonfigurasi (O9) — dikecualikan + bobot didistribusi ulang"}
	}
	if placeholder {
		pt.used = true
	}
	speedPct := avgHours / target * 100
	return candidate{name: CompComplaintResolutionSpeed, included: true, raw: transformSpeed(speedPct)}
}

// amResolutionHours = mean (resolved_at − created_at) hours over complaints
// assigned to the AM that transitioned into [Resolved] within the period. Recompute
// from the immutable audit log (house rule 4).
func amResolutionHours(ctx context.Context, q rowQuerier, staffID string, per period) (float64, bool, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, created_at FROM complaints WHERE assigned_to = ?`, staffID)
	if err != nil {
		return 0, false, err
	}
	type cpl struct {
		id        string
		createdAt time.Time
	}
	var cpls []cpl
	for rows.Next() {
		var c cpl
		if err := rows.Scan(&c.id, &c.createdAt); err != nil {
			rows.Close()
			return 0, false, err
		}
		cpls = append(cpls, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, false, err
	}
	rows.Close()

	var sum float64
	var n int
	for _, c := range cpls {
		entries, err := audit.List(ctx, q, audit.Filter{EntityType: "complaint", EntityID: c.id})
		if err != nil {
			return 0, false, err
		}
		resolvedAt, ok := firstTransitionInto(entries, "[Resolved]")
		if !ok || resolvedAt.Before(per.startUTC) || !resolvedAt.Before(per.endUTC) {
			continue
		}
		sum += resolvedAt.Sub(c.createdAt).Hours()
		n++
	}
	if n == 0 {
		return 0, false, nil
	}
	return sum / float64(n), true, nil
}

// amRevisionEscalation = 100 − flaggedFraction × 100 over the AM portfolio's Tasks
// (Creative Assets + Ads Briefs) approved in the period. Flagged = revision_count
// ≥ 3 (M12 Rule 15), recomputed from the log.
func (s *Service) amRevisionEscalation(ctx context.Context, q rowQuerier, clientIDs []string, per period) (candidate, error) {
	var approved, flagged int
	for _, cid := range clientIDs {
		// Creative Assets.
		aRows, err := q.QueryContext(ctx,
			`SELECT a.id, a.sla_target_hours
			   FROM assets a JOIN briefs b ON b.id = a.brief_id
			   JOIN services sv ON sv.id = b.service_id
			  WHERE sv.client_id = ?`, cid)
		if err != nil {
			return candidate{}, err
		}
		type tr struct {
			id  string
			sla *float64
		}
		var tasks []tr
		for aRows.Next() {
			var t tr
			var sla sql.NullFloat64
			if err := aRows.Scan(&t.id, &sla); err != nil {
				aRows.Close()
				return candidate{}, err
			}
			t.sla = nullFloatPtr(sla)
			tasks = append(tasks, t)
		}
		if err := aRows.Err(); err != nil {
			aRows.Close()
			return candidate{}, err
		}
		aRows.Close()
		for _, t := range tasks {
			m, err := s.assetMetrics(ctx, q, t.id, t.sla)
			if err != nil {
				return candidate{}, err
			}
			if m.ApprovedPeriodWIB != per.approvedTag {
				continue
			}
			approved++
			if m.RevisionFlagged {
				flagged++
			}
		}
		// Ads Briefs-as-task.
		bRows, err := q.QueryContext(ctx,
			`SELECT b.id, b.sla_target_hours
			   FROM briefs b JOIN services sv ON sv.id = b.service_id
			  WHERE sv.client_id = ? AND b.assigned_division = ?`, cid, adsBriefDivision)
		if err != nil {
			return candidate{}, err
		}
		var briefs []tr
		for bRows.Next() {
			var t tr
			var sla sql.NullFloat64
			if err := bRows.Scan(&t.id, &sla); err != nil {
				bRows.Close()
				return candidate{}, err
			}
			t.sla = nullFloatPtr(sla)
			briefs = append(briefs, t)
		}
		if err := bRows.Err(); err != nil {
			bRows.Close()
			return candidate{}, err
		}
		bRows.Close()
		for _, t := range briefs {
			m, err := s.briefMetrics(ctx, q, t.id, t.sla)
			if err != nil {
				return candidate{}, err
			}
			if m.ApprovedPeriodWIB != per.approvedTag {
				continue
			}
			approved++
			if m.RevisionFlagged {
				flagged++
			}
		}
	}
	if approved == 0 {
		return candidate{name: CompRevisionEscalationRate, included: false,
			reason: "tidak ada Task portofolio yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang"}, nil
	}
	return candidate{name: CompRevisionEscalationRate, included: true,
		raw: 100 - float64(flagged)/float64(approved)*100}, nil
}

// ---- shared candidate builders ----

// speedCandidate builds the Speed Score candidate: average Speed Score % across the
// staff's period-judged tasks, then the OA-1 transform. Excluded when no SLA-judged
// task closed in the period.
func speedCandidate(speedSum float64, judged int) candidate {
	if judged == 0 {
		return candidate{name: CompSpeedScore, included: false,
			reason: "tidak ada Task ber-SLA yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang"}
	}
	avg := speedSum / float64(judged)
	return candidate{name: CompSpeedScore, included: true, raw: transformSpeed(avg)}
}

// revisionCandidate builds the inverse Revision Count candidate (100 − min(avg × 20,
// 100)), over the same period-approved set. Excluded when none approved.
func revisionCandidate(revisionSum float64, approved int) candidate {
	if approved == 0 {
		return candidate{name: CompRevisionCount, included: false,
			reason: "tidak ada Task yang selesai [Approved] pada periode — dikecualikan + bobot didistribusi ulang"}
	}
	avg := revisionSum / float64(approved)
	burden := 100 - minFloat(avg*revisionInverseFactor, 100)
	return candidate{name: CompRevisionCount, included: true, raw: burden}
}

// ---- task-metric helpers (recompute from the immutable log, house rule 4) ----

func (s *Service) assetMetrics(ctx context.Context, q rowQuerier, id string, sla *float64) (module12_task.Metrics, error) {
	trs, err := taskTransitions(ctx, q, "asset", id)
	if err != nil {
		return module12_task.Metrics{}, err
	}
	return module12_task.ComputeMappedMetrics(trs, sla), nil
}

func (s *Service) briefMetrics(ctx context.Context, q rowQuerier, id string, sla *float64) (module12_task.Metrics, error) {
	trs, err := taskTransitions(ctx, q, "brief", id)
	if err != nil {
		return module12_task.Metrics{}, err
	}
	return module12_task.ComputeMappedMetrics(trs, sla), nil
}

// taskTransitions reads a canonical Task's immutable transition log ASCENDING and
// maps it to module12_task.Transition (mirrors module13_health.taskTransitions).
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

// transitionCountInPeriod counts transitions INTO `to` whose timestamp falls in the
// WIB period window (recompute from log).
func transitionCountInPeriod(entries []audit.Entry, to string, per period) int {
	n := 0
	for _, e := range entries {
		if t, ok := transitionTarget(e.Action); ok && t == to {
			if !e.CreatedAt.Before(per.startUTC) && e.CreatedAt.Before(per.endUTC) {
				n++
			}
		}
	}
	return n
}

// firstTransitionInto returns the timestamp of the first transition INTO `to`.
func firstTransitionInto(entries []audit.Entry, to string) (time.Time, bool) {
	// entries are DESC by id; the LAST matching (walking DESC) is the earliest.
	var found bool
	var at time.Time
	for _, e := range entries {
		if t, ok := transitionTarget(e.Action); ok && t == to {
			at = e.CreatedAt
			found = true
		}
	}
	return at, found
}

// transitionTarget extracts B from a "transition:A->B" audit action.
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
