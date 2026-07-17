package module2_marketing

import (
	"context"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/module3_campaign"
)

// activeCampaignWithRecord creates a campaign owned by owner, activates it, and attaches a
// performance record with the given budget. Returns the campaign id.
func activeCampaignWithRecord(t *testing.T, s *Service, owner, budget string) string {
	t.Helper()
	ctx := context.Background()
	c, err := s.campaign().Create(ctx, mktStaff(owner), validInput())
	if err != nil {
		t.Fatalf("create campaign: %v", err)
	}
	if _, err := s.campaign().Transition(ctx, mktStaff(owner), c.ID, module3_campaign.StatusActive); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if _, err := s.CreateRecord(ctx, mktStaff(owner), c.ID, budget); err != nil {
		t.Fatalf("create record: %v", err)
	}
	return c.ID
}

// TestMetrics_RecomputeFromLog builds the PRD §4 worked example (CMP-202603-0007) from raw
// linkage rows and asserts every derived metric recomputes to the hand-calculated value.
func TestMetrics_RecomputeFromLog(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	d := s.DB
	cid := activeCampaignWithRecord(t, s, "EMP-LIA", "5000000") // Budget Rp 5.000.000
	win := time.Date(2026, 3, 20, 10, 0, 0, 0, time.UTC)

	// 46 leads on the dashboard (origin = cmp); make 12 reach Qualified (real leads).
	for i := 0; i < 46; i++ {
		lid := "LEAD-" + itoa(i)
		seedLead(t, d, lid, "08110"+pad(i), cid, cid)
		seedAttemptReachedQualified(t, d, "PRSP-"+itoa(i), lid, i < 12)
	}

	// 3 won deals attributed by LAST-TOUCH to cmp: 9.000.000 + 6.900.000 + 6.000.000 =
	// Rp 21.900.000 (PRD example).
	seedWonClient(t, d, "CLI-1", "TRX-1", "LEAD-0", cid, "9000000.00", win)
	seedWonClient(t, d, "CLI-2", "TRX-2", "LEAD-1", cid, "6900000.00", win)
	seedWonClient(t, d, "CLI-3", "TRX-3", "LEAD-2", cid, "6000000.00", win)

	m, err := s.Metrics(ctx, mktStaff("EMP-LIA"), cid)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	checkStr(t, "lead_by_dashboard", itoa(m.LeadByDashboard), "46")
	checkStr(t, "lead_real_by_sales", itoa(m.LeadRealBySales), "12")
	checkStr(t, "lead_quality_rate", m.LeadQualityRate, "26%") // 12/46 = 26.08 -> 26%
	checkStr(t, "attributed_sales", m.AttributedSales, "Rp. 21.900.000,00")
	checkStr(t, "attributed_sales_decimal", m.AttributedSalesDec, "21900000.00")
	checkStr(t, "roas", m.ROAS, "4.38")                                    // 21.9M / 5M
	checkStr(t, "cost_per_lead", m.CostPerLead, "Rp. 108.695,00")          // 5M/46 = 108695.65
	checkStr(t, "cost_per_real_lead", m.CostPerRealLead, "Rp. 416.666,00") // 5M/12 = 416666.67
	checkStr(t, "budget_idr", m.BudgetIDR, "Rp. 5.000.000,00")
}

// TestMetrics_LastTouchDivergesFromOrigin proves the DELIBERATE M2-OA-2 divergence: M2
// Attributed Sales credits the lead's LAST-TOUCH campaign, while M3's rollup credits the
// immutable ORIGIN campaign. A single lead touched by two campaigns lands its value in
// different buckets for the two modules.
func TestMetrics_LastTouchDivergesFromOrigin(t *testing.T) {
	s, cmpSvc := newService(t)
	ctx := context.Background()
	d := s.DB
	origin := activeCampaignWithRecord(t, s, "EMP-LIA", "1000000")    // CMP origin
	lastTouch := activeCampaignWithRecord(t, s, "EMP-LIA", "1000000") // CMP last-touch
	win := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)

	// One multi-touch lead: Origin = origin, Last-Touch = lastTouch.
	seedLead(t, d, "LEAD-MT", "08110999", origin, lastTouch)
	// The won client's stored Origin Campaign (stamped at closing) = origin.
	seedWonClient(t, d, "CLI-MT", "TRX-MT", "LEAD-MT", origin, "8000000.00", win)

	// M2 Attributed Sales: credited to LAST-TOUCH campaign, NOT origin.
	mLast, err := s.Metrics(ctx, mktStaff("EMP-LIA"), lastTouch)
	if err != nil {
		t.Fatalf("Metrics last-touch: %v", err)
	}
	checkStr(t, "attributed (last-touch)", mLast.AttributedSalesDec, "8000000.00")

	mOrigin, err := s.Metrics(ctx, mktStaff("EMP-LIA"), origin)
	if err != nil {
		t.Fatalf("Metrics origin: %v", err)
	}
	checkStr(t, "attributed (origin campaign)", mOrigin.AttributedSalesDec, "0.00")

	// M3 rollup: "Clients won" / "Total value won" credit the ORIGIN campaign — the mirror
	// image, confirming the by-design divergence (M2-OA-2).
	roll, err := cmpSvc.Rollup(ctx, mktStaff("EMP-LIA"), origin)
	if err != nil {
		t.Fatalf("M3 rollup origin: %v", err)
	}
	if roll.ClientsWon != 1 || roll.TotalValueWon != "8000000.00" {
		t.Fatalf("M3 origin rollup=%+v want ClientsWon=1 TotalValueWon=8000000.00", roll)
	}
	rollLast, err := cmpSvc.Rollup(ctx, mktStaff("EMP-LIA"), lastTouch)
	if err != nil {
		t.Fatalf("M3 rollup last-touch: %v", err)
	}
	if rollLast.ClientsWon != 0 {
		t.Fatalf("M3 last-touch ClientsWon=%d want 0 (origin-based)", rollLast.ClientsWon)
	}
}

// TestMetrics_ThreeMonthWindow: after a campaign is Closed, a win dated within 3 months of
// end_date is credited; a win beyond the window is not (M3-OA-4). No clock is consulted —
// the window is end_date vs win_date.
func TestMetrics_ThreeMonthWindow(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	d := s.DB
	owner := mktStaff("EMP-LIA")

	c, err := s.campaign().Create(ctx, owner, validInput())
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	cid := c.ID
	if _, err := s.campaign().Transition(ctx, owner, cid, module3_campaign.StatusActive); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if _, err := s.CreateRecord(ctx, owner, cid, "1000000"); err != nil {
		t.Fatalf("record: %v", err)
	}

	// Two attributed leads/wins BEFORE closing so end_date is stamped now (WIB today). We
	// then place one win inside the window and one beyond by dating them relative to a fixed
	// end_date we read back.
	seedLead(t, d, "LEAD-IN", "08110001", cid, cid)
	seedLead(t, d, "LEAD-OUT", "08110002", cid, cid)

	if _, err := s.campaign().Transition(ctx, owner, cid, module3_campaign.StatusClosed); err != nil {
		t.Fatalf("close: %v", err)
	}
	got, err := s.campaign().Get(ctx, owner, cid)
	if err != nil || got.EndDate == nil {
		t.Fatalf("get after close: %v end=%v", err, got.EndDate)
	}
	end, _ := time.Parse("2006-01-02", *got.EndDate)

	inWin := end.AddDate(0, 2, 0)  // 2 months after Close -> within window
	outWin := end.AddDate(0, 4, 0) // 4 months after Close -> beyond 3-month window
	seedWonClient(t, d, "CLI-IN", "TRX-IN", "LEAD-IN", cid, "5000000.00", inWin)
	seedWonClient(t, d, "CLI-OUT", "TRX-OUT", "LEAD-OUT", cid, "9000000.00", outWin)

	m, err := s.Metrics(ctx, owner, cid)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	// Only the in-window win (5.000.000) is credited; the out-of-window win (9.000.000) is not.
	checkStr(t, "attributed within window", m.AttributedSalesDec, "5000000.00")
}

// TestMetrics_DivZeroRenders: no leads / no budget renders "—", never an error (house #7).
func TestMetrics_DivZeroRenders(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	// Campaign with a record but NO leads/attributed sales.
	cid := activeCampaignWithRecord(t, s, "EMP-LIA", "5000000")
	m, err := s.Metrics(ctx, mktStaff("EMP-LIA"), cid)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	checkStr(t, "cpl (no leads)", m.CostPerLead, emDash)
	checkStr(t, "cprl (no real leads)", m.CostPerRealLead, emDash)
	checkStr(t, "quality (no leads)", m.LeadQualityRate, emDash)
	checkStr(t, "roas (no sales)", m.ROAS, "0.00") // Attributed 0 / Budget 5M = 0.00 (not div-zero)
	// Attributed with zero sales is a valid Rp. 0,00, never "—".
	checkStr(t, "attributed (zero)", m.AttributedSales, "Rp. 0,00")
}

// TestMetrics_CollectedROAS: Collected uses only VERIFIED-received amounts (M2-OA-5). With a
// deal booked at 10M but only 4M verified (2M direct + 2M via a verified installment),
// headline ROAS uses 10M while Collected-ROAS uses 4M.
func TestMetrics_CollectedROAS(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	d := s.DB
	cid := activeCampaignWithRecord(t, s, "EMP-LIA", "2000000") // Budget 2M
	win := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)

	seedLead(t, d, "LEAD-C", "08110777", cid, cid)
	seedWonClient(t, d, "CLI-C", "TRX-C", "LEAD-C", cid, "10000000.00", win) // booked 10M
	seedDirectVerification(t, d, "TRX-C", "2000000.00")                      // 2M direct verified
	seedVerifiedInstallment(t, d, "INST-C1", "TRX-C", 1, "2000000.00")       // 2M verified termin
	// (remaining 6M unverified -> excluded from Collected)

	m, err := s.Metrics(ctx, mktStaff("EMP-LIA"), cid)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	checkStr(t, "attributed (booked)", m.AttributedSalesDec, "10000000.00")
	checkStr(t, "roas (booked/budget)", m.ROAS, "5.00")                    // 10M / 2M
	checkStr(t, "collected (verified)", m.CollectedSalesDec, "4000000.00") // 2M + 2M
	checkStr(t, "collected_roas", m.CollectedROAS, "2.00")                 // 4M / 2M
}

// TestMetrics_JunkBreakdown: NQ reason counts for the campaign's Origin leads, verbatim.
func TestMetrics_JunkBreakdown(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	d := s.DB
	cid := activeCampaignWithRecord(t, s, "EMP-LIA", "5000000")
	other := activeCampaignWithRecord(t, s, "EMP-LIA", "5000000")

	seedLead(t, d, "LEAD-A", "08110011", cid, cid)
	seedLead(t, d, "LEAD-B", "08110012", cid, cid)
	seedLead(t, d, "LEAD-Z", "08110013", other, other) // different campaign, must not leak
	seedAttemptReachedQualified(t, d, "PRSP-A", "LEAD-A", false)
	seedAttemptReachedQualified(t, d, "PRSP-B", "LEAD-B", false)
	seedAttemptReachedQualified(t, d, "PRSP-Z", "LEAD-Z", false)
	seedNQReason(t, d, "PRSP-A", "[Bukan seller]")
	seedNQReason(t, d, "PRSP-A", "[Tidak ada respon]")
	seedNQReason(t, d, "PRSP-B", "[Bukan seller]")
	seedNQReason(t, d, "PRSP-Z", "[Kontak salah]") // on the other campaign

	m, err := s.Metrics(ctx, mktStaff("EMP-LIA"), cid)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	if len(m.JunkBreakdown) != 2 {
		t.Fatalf("junk breakdown len=%d want 2 (%+v)", len(m.JunkBreakdown), m.JunkBreakdown)
	}
	// Ordered by count desc: [Bukan seller]=2 first, then [Tidak ada respon]=1.
	checkStr(t, "junk[0].reason", m.JunkBreakdown[0].Reason, "[Bukan seller]")
	if m.JunkBreakdown[0].Count != 2 {
		t.Fatalf("junk[0].count=%d want 2", m.JunkBreakdown[0].Count)
	}
	checkStr(t, "junk[1].reason", m.JunkBreakdown[1].Reason, "[Tidak ada respon]")
}

// TestDashboard_LeadStaffSplit: staff sees only own campaigns; lead/OD/Director see all
// (M2 §5). Metrics are attached per campaign for cross-campaign comparison.
func TestDashboard_LeadStaffSplit(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	lia := activeCampaignWithRecord(t, s, "EMP-LIA", "5000000")
	dina := activeCampaignWithRecord(t, s, "EMP-DINA", "3000000")

	// Lia (staff) sees only her campaign.
	list, err := s.Dashboard(ctx, mktStaff("EMP-LIA"))
	if err != nil {
		t.Fatalf("lia dashboard: %v", err)
	}
	if len(list) != 1 || list[0].CampaignID != lia {
		t.Fatalf("lia dashboard=%+v want only %s", list, lia)
	}
	// Lead sees all (both), with per-campaign metrics for comparison.
	leadList, err := s.Dashboard(ctx, mktLead("EMP-MHEAD"))
	if err != nil {
		t.Fatalf("lead dashboard: %v", err)
	}
	if len(leadList) != 2 {
		t.Fatalf("lead dashboard len=%d want 2", len(leadList))
	}
	_ = dina
	// OD read-only sees all.
	odList, err := s.Dashboard(ctx, od("EMP-OD"))
	if err != nil || len(odList) != 2 {
		t.Fatalf("OD dashboard len=%d err=%v want 2", len(odList), err)
	}
	// Foreign division denied.
	if _, err := s.Dashboard(ctx, salesStaff("EMP-SAL")); err == nil {
		t.Fatalf("sales dashboard err=nil want ErrForbidden")
	}
}

// TestDashboard_CampaignWithoutRecord: a campaign listed before its record exists shows
// budget-dependent metrics as "—" but still computes lead counts.
func TestDashboard_CampaignWithoutRecord(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	c, err := s.campaign().Create(ctx, mktStaff("EMP-LIA"), validInput())
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	list, err := s.Dashboard(ctx, mktStaff("EMP-LIA"))
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	if len(list) != 1 || list[0].CampaignID != c.ID {
		t.Fatalf("dashboard=%+v want one entry for %s", list, c.ID)
	}
	checkStr(t, "budget_idr (no record)", list[0].BudgetIDR, emDash)
	checkStr(t, "cpl (no record)", list[0].CostPerLead, emDash)
	checkStr(t, "roas (no record)", list[0].ROAS, emDash)
}

// ---- tiny local helpers (avoid strconv churn in table-heavy tests) ----

func checkStr(t *testing.T, field, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %q, want %q", field, got, want)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// pad returns a 4-digit zero-padded suffix for unique phone numbers.
func pad(n int) string {
	s := itoa(n)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}
