package module14_performance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var bg = context.Background()

// Fixed clock: WIB 2026-07-17 → most-recently CLOSED month = June 2026.
var nowJul = time.Date(2026, 7, 17, 5, 0, 0, 0, time.UTC)

const junePeriod = "202606"

// ---- actors ----

func adsStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AdsDivision, Level: permission.LevelStaff}}
}
func adsLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AdsDivision, Level: permission.LevelLead}}
}
func amStaffActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func odActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}

func svc(t *testing.T) *Service {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Catalog: notification.NewCatalog()}
}

// ---- fixture inserters ----

func insClient(t *testing.T, d *sql.DB, id, amID string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		   total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_at, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00', 'EMP-BUDI', 'EMP-BUDI', NOW(), ?, ?, 'TEST')`,
		id, id, amID, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("insClient: %v", err)
	}
}

func insService(t *testing.T, d *sql.DB, id, clientID string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name,
		   standard_price, commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', '[In Execution]', 0, 'TEST')`, id, clientID)
	if err != nil {
		t.Fatalf("insService: %v", err)
	}
}

// insBrief inserts an Ads Brief-as-task assigned to pic, [Approved] within SLA in
// June (speed 50% → transform 100).
func insAdsBrief(t *testing.T, d *sql.DB, id, svcID, pic string, sla, turnaroundH float64) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO briefs (id, service_id, title, status, assigned_division, assigned_pic, sla_target_hours, created_by)
		 VALUES (?, ?, 'B', '[Approved]', 'Ads', ?, ?, 'TEST')`, id, svcID, pic, sla)
	if err != nil {
		t.Fatalf("insAdsBrief: %v", err)
	}
	start := time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)
	insAudit(t, d, "brief", id, "transition:[To Do]->[In Progress]", start)
	insAudit(t, d, "brief", id, "transition:[In Review]->[Approved]", start.Add(time.Duration(turnaroundH*float64(time.Hour))))
}

func insAudit(t *testing.T, d *sql.DB, entityType, entityID, action string, at time.Time) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
		 VALUES (?, ?, 'system', ?, 'system', ?)`, entityType, entityID, action, at.UTC())
	if err != nil {
		t.Fatalf("insAudit: %v", err)
	}
}

func insAdCampaign(t *testing.T, d *sql.DB, id, briefID, clientID, targetKPI string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
		 VALUES (?, ?, ?, 'Shopee Ads', 'Conversion', '100000000.00', '2026-06-01', '2026-12-31', ?, '[Active]', 'TEST')`,
		id, briefID, clientID, targetKPI)
	if err != nil {
		t.Fatalf("insAdCampaign: %v", err)
	}
}

func insMetricEntry(t *testing.T, d *sql.DB, id, campaignID, periodStart, spend, gmv string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, 'Manual', 'system', 'system')`, id, campaignID, periodStart, periodStart, spend, gmv)
	if err != nil {
		t.Fatalf("insMetricEntry: %v", err)
	}
}

func insOptimization(t *testing.T, d *sql.DB, id, campaignID, actor string, at time.Time) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO optimization_logs (id, campaign_id, change_type, before_value, after_value, reason, actor, created_at, created_by)
		 VALUES (?, ?, 'Budget', 'a', 'b', 'r', ?, ?, 'system')`, id, campaignID, actor, at.UTC())
	if err != nil {
		t.Fatalf("insOptimization: %v", err)
	}
}

// insCHRSnapshot inserts a June CHR snapshot for a client with a crafted
// components_json (so the modifier can read a roas_attainment sub-score).
func insCHRSnapshot(t *testing.T, d *sql.DB, id, clientID string, final float64, componentsJSON string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
		 VALUES (?, ?, '2026-06-01', '2026-06-30', ?, 'Watch', 1, ?, 'system')`,
		id, clientID, final, componentsJSON)
	if err != nil {
		t.Fatalf("insCHRSnapshot: %v", err)
	}
}

func setTargetRow(t *testing.T, d *sql.DB, roleType, comp, periodStart string, target float64, placeholder bool) {
	t.Helper()
	ph := 0
	if placeholder {
		ph = 1
	}
	_, err := d.ExecContext(bg,
		`INSERT INTO perf_period_targets (role_type, component, period_start, target_value, is_placeholder, updated_by)
		 VALUES (?, ?, ?, ?, ?, 'TEST')
		 ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), is_placeholder=VALUES(is_placeholder)`,
		roleType, comp, periodStart, target, ph)
	if err != nil {
		t.Fatalf("setTargetRow: %v", err)
	}
}

func compByName(comps []Component, name string) Component {
	for _, c := range comps {
		if c.Name == name {
			return c
		}
	}
	return Component{}
}

// kennyFixture builds the §4 worked example: Advertiser Kenny, June 2026 →
// profile 86.4, modifier +2, final 88.4.
func kennyFixture(t *testing.T, s *Service) {
	testutil.InsertEmployee(t, s.DB, "EMP-KENNY", "Kenny", "kenny@mea.id", "Ads", "Ads Specialist", true)
	testutil.InsertRoleMapping(t, s.DB, "Ads", "Ads Specialist", "Ads", "staff")

	insClient(t, s.DB, "CLI-K", "EMP-AM")
	insService(t, s.DB, "SVC-K", "CLI-K")
	// Speed: Ads brief approved within SLA (5h / 10h = 50% → transform 100).
	insAdsBrief(t, s.DB, "BRF-K", "SVC-K", "EMP-KENNY", 10, 5)
	// ROAS: target 5, period ROAS 4.4 (spend 100M, gmv 440M) → 88. gmvSum = 440M.
	insAdCampaign(t, s.DB, "ADC-K", "BRF-K", "CLI-K", "ROAS 5")
	insMetricEntry(t, s.DB, "MTR-K", "ADC-K", "2026-06-05", "100000000.00", "440000000.00")
	// Optimization: 15 logs in June, actor Kenny.
	for i := 0; i < 15; i++ {
		insOptimization(t, s.DB, fmt.Sprintf("OPT-K-%02d", i), "ADC-K", "EMP-KENNY",
			time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	}
	// June-specific NON-placeholder targets tuned to the §4 illustrative sub-scores:
	//   GMV Impact  = 440M / 550M × 100 = 80
	//   Optimization= 15 / 20 × 100 = 75
	setTargetRow(t, s.DB, RoleAds, CompGMVImpact, "2026-06-01", 550000000, false)
	setTargetRow(t, s.DB, RoleAds, CompOptimizationActivity, "2026-06-01", 20, false)
	// Modifier source: CLI-K June CHR snapshot with ROAS Attainment sub-score 84.
	insCHRSnapshot(t, s.DB, "CHR-202606-0001", "CLI-K", 84,
		`[{"name":"roas_attainment","included":true,"capped":84}]`)
}

// ---- worked example end to end ----

func TestSnapshot_KennyEndToEnd(t *testing.T) {
	s := svc(t)
	kennyFixture(t, s)

	res, err := s.RunSnapshotJob(bg, nowJul)
	if err != nil {
		t.Fatalf("RunSnapshotJob: %v", err)
	}
	if res.Period != junePeriod || res.SnapshotsMade != 1 {
		t.Fatalf("scan result = %+v, want period 202606 / 1 snapshot", res)
	}

	snap, err := s.GetSnapshot(bg, director("D"), "EMP-KENNY", junePeriod)
	if err != nil {
		t.Fatalf("GetSnapshot: %v", err)
	}
	if snap.RoleType != RoleAds {
		t.Errorf("role type = %q, want Ads", snap.RoleType)
	}
	if snap.ProfileScore == nil || math.Abs(*snap.ProfileScore-86.4) > 0.01 {
		t.Errorf("profile = %v, want 86.4", snap.ProfileScore)
	}
	if math.Abs(snap.Modifier.Value-2) > 0.001 || !snap.Modifier.Present {
		t.Errorf("modifier = %+v, want +2 present", snap.Modifier)
	}
	if snap.FinalScore == nil || math.Abs(*snap.FinalScore-88.4) > 0.01 {
		t.Errorf("final = %v, want 88.4", snap.FinalScore)
	}
	// Full breakdown mandatory (Rule 8): every weighted sub-score present.
	for name, want := range map[string]float64{
		CompSpeedScore: 100, CompROASAttainment: 88, CompGMVImpact: 80, CompOptimizationActivity: 75,
	} {
		c := compByName(snap.Components, name)
		if !c.Included || c.Raw == nil || math.Abs(*c.Raw-want) > 0.01 {
			t.Errorf("component %s raw = %v, want %v (included=%v)", name, c.Raw, want, c.Included)
		}
	}
	// Modifier source client recorded (§5.1).
	if len(snap.Modifier.SourceClients) != 1 || snap.Modifier.SourceClients[0] != "CLI-K" {
		t.Errorf("modifier source clients = %v, want [CLI-K]", snap.Modifier.SourceClients)
	}
	// Real (non-placeholder) targets used → flag false.
	if snap.TargetsPlaceholder {
		t.Error("targets_placeholder should be false (June targets are non-placeholder)")
	}
}

// ---- emission fire-once (Flow 6) + idempotency ----

func TestSnapshot_EmitPerStaffFireOnce(t *testing.T) {
	s := svc(t)
	kennyFixture(t, s)
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	notes, err := notification.List(bg, s.DB, "EMP-KENNY", false)
	if err != nil {
		t.Fatal(err)
	}
	pub := 0
	for _, n := range notes {
		if n.EventType == string(notification.EvPerformancePublished) {
			pub++
		}
	}
	if pub != 1 {
		t.Fatalf("EvPerformancePublished for Kenny = %d, want 1", pub)
	}
	// Re-run: idempotent, no new snapshot, no new emission.
	res, err := s.RunSnapshotJob(bg, nowJul)
	if err != nil {
		t.Fatal(err)
	}
	if res.SnapshotsMade != 0 {
		t.Fatalf("second sweep made %d, want 0 (idempotent)", res.SnapshotsMade)
	}
	notes2, _ := notification.List(bg, s.DB, "EMP-KENNY", false)
	if len(notes2) != len(notes) {
		t.Fatalf("re-run added notifications: %d → %d", len(notes), len(notes2))
	}
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM performance_snapshots WHERE staff_id='EMP-KENNY'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("snapshot count = %d, want 1", n)
	}
}

// ---- immutability (house rule 3 / §5.4 storage triggers) ----

func TestSnapshot_Immutable(t *testing.T) {
	s := svc(t)
	kennyFixture(t, s)
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := s.DB.QueryRow(`SELECT id FROM performance_snapshots WHERE staff_id='EMP-KENNY'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE performance_snapshots SET final_score=1 WHERE id=?`, id); err == nil {
		t.Error("UPDATE on snapshot should be blocked by the immutability trigger")
	}
	if _, err := s.DB.Exec(`DELETE FROM performance_snapshots WHERE id=?`, id); err == nil {
		t.Error("DELETE on snapshot should be blocked by the immutability trigger")
	}
}

// ---- AM profile (avg CHR 50%) + redistribution when the other two are missing ----

func TestSnapshot_AMProfileCHRAverage(t *testing.T) {
	s := svc(t)
	testutil.InsertEmployee(t, s.DB, "EMP-AMS", "Ana", "ana@mea.id", "Account", "Account Manager", true)
	testutil.InsertRoleMapping(t, s.DB, "Account", "Account Manager", "Account", "staff")

	// Two portfolio clients with June CHR snapshots (final 80 and 90 → avg 85).
	insClient(t, s.DB, "CLI-A1", "EMP-AMS")
	insClient(t, s.DB, "CLI-A2", "EMP-AMS")
	insCHRSnapshot(t, s.DB, "CHR-202606-0001", "CLI-A1", 80, `[]`)
	insCHRSnapshot(t, s.DB, "CHR-202606-0002", "CLI-A2", 90, `[]`)

	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	snap, err := s.GetSnapshot(bg, director("D"), "EMP-AMS", junePeriod)
	if err != nil {
		t.Fatalf("GetSnapshot: %v", err)
	}
	// Complaint + revision components missing → redistribution → chr_average 100%
	// effective weight → profile = avg CHR = 85. AM has NO modifier.
	chr := compByName(snap.Components, CompCHRAverage)
	if !chr.Included || chr.Raw == nil || math.Abs(*chr.Raw-85) > 0.01 {
		t.Errorf("chr_average raw = %v, want 85", chr.Raw)
	}
	if math.Abs(chr.EffectiveWeight-100) > 0.01 {
		t.Errorf("chr effective weight = %v, want 100 (redistributed)", chr.EffectiveWeight)
	}
	if snap.ProfileScore == nil || math.Abs(*snap.ProfileScore-85) > 0.01 {
		t.Errorf("AM profile = %v, want 85", snap.ProfileScore)
	}
	if snap.Modifier.Present {
		t.Error("AM must have no Client-Outcome Modifier (Rule 3)")
	}
	if snap.FinalScore == nil || math.Abs(*snap.FinalScore-85) > 0.01 {
		t.Errorf("AM final = %v, want 85", snap.FinalScore)
	}
}

// ---- placeholder target flagged ----

func TestSnapshot_PlaceholderTargetFlagged(t *testing.T) {
	s := svc(t)
	// KOL coordinator with a QC-passed booking in June, using the seeded PLACEHOLDER
	// creator_count target (10).
	testutil.InsertEmployee(t, s.DB, "EMP-KOL", "Koko", "koko@mea.id", "KOL", "KOL Specialist", true)
	testutil.InsertRoleMapping(t, s.DB, "KOL", "KOL Specialist", "KOL", "staff")
	insClient(t, s.DB, "CLI-KOL", "EMP-AM")
	insService(t, s.DB, "SVC-KOL", "CLI-KOL")
	_, err := s.DB.ExecContext(bg,
		`INSERT INTO briefs (id, service_id, title, status, assigned_division, created_by)
		 VALUES ('BRF-KOL','SVC-KOL','B','[In Progress]','KOL','TEST')`)
	if err != nil {
		t.Fatal(err)
	}
	created := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	_, err = s.DB.ExecContext(bg,
		`INSERT INTO creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate, status, sla_target_hours, assigned_coordinator, created_at, created_by)
		 VALUES ('BKG-KOL','BRF-KOL','C','TikTok','MCN MEA Roster','1000000.00','[QC Passed]', 100, 'EMP-KOL', ?, 'TEST')`, created)
	if err != nil {
		t.Fatal(err)
	}
	insAudit(t, s.DB, "creator_booking", "BKG-KOL", "transition:[QC Review]->[QC Passed]",
		time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC))

	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	snap, err := s.GetSnapshot(bg, director("D"), "EMP-KOL", junePeriod)
	if err != nil {
		t.Fatalf("GetSnapshot: %v", err)
	}
	if !snap.TargetsPlaceholder {
		t.Error("targets_placeholder should be true (creator_count used the seeded placeholder target)")
	}
	cc := compByName(snap.Components, CompCreatorCount)
	if !cc.Included || cc.Raw == nil || math.Abs(*cc.Raw-10) > 0.01 { // 1/10×100 = 10
		t.Errorf("creator_count raw = %v, want 10", cc.Raw)
	}
	// Sourcing Turnaround is a diagnostic row.
	st := compByName(snap.Components, CompSourcingTurnaround)
	if !st.Diagnostic {
		t.Error("sourcing_turnaround must be a diagnostic component")
	}
}

// ---- visibility (Rule 7) incl. layered OD/Director + scan gate ----

func TestVisibility_And_Gates(t *testing.T) {
	s := svc(t)
	kennyFixture(t, s)
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}

	// Kenny sees his own.
	if _, err := s.GetSnapshot(bg, adsStaff("EMP-KENNY"), "EMP-KENNY", junePeriod); err != nil {
		t.Errorf("own score: %v", err)
	}
	// A different Ads staffer cannot see Kenny's (own-only).
	if _, err := s.GetSnapshot(bg, adsStaff("EMP-OTHER"), "EMP-KENNY", junePeriod); !errors.Is(err, ErrNotFound) {
		t.Errorf("other Ads staff: want ErrNotFound, got %v", err)
	}
	// Ads lead (division-wide), OD, Director all see it.
	for _, a := range []permission.Actor{adsLead("L"), odActor("O"), director("D")} {
		if _, err := s.GetSnapshot(bg, a, "EMP-KENNY", junePeriod); err != nil {
			t.Errorf("actor %+v: %v", a.Role, err)
		}
	}
	// A Creative lead may NOT see an Ads staffer (cross-division).
	creativeLead := permission.Actor{EmployeeID: "CL", Role: permission.Role{Division: CreativeDivision, Level: permission.LevelLead}}
	if _, err := s.GetSnapshot(bg, creativeLead, "EMP-KENNY", junePeriod); !errors.Is(err, ErrNotFound) {
		t.Errorf("creative lead cross-division: want ErrNotFound, got %v", err)
	}

	// Scan gate: Director only.
	if _, err := s.RunScan(bg, director("D"), nowJul); err != nil {
		t.Errorf("director scan: %v", err)
	}
	if _, err := s.RunScan(bg, adsLead("L"), nowJul); !errors.Is(err, ErrScanForbidden) {
		t.Errorf("ads lead scan: want ErrScanForbidden, got %v", err)
	}
	if _, err := s.RunScan(bg, odActor("O"), nowJul); !errors.Is(err, ErrScanForbidden) {
		t.Errorf("OD scan: want ErrScanForbidden, got %v", err)
	}
}

// ---- team rollup (Rule 5 simple average, derived on read) ----

func TestTeamRollup(t *testing.T) {
	s := svc(t)
	// Two Ads staff with different finals → simple average.
	testutil.InsertEmployee(t, s.DB, "EMP-K1", "K1", "k1@mea.id", "Ads", "Ads Specialist", true)
	testutil.InsertEmployee(t, s.DB, "EMP-K2", "K2", "k2@mea.id", "Ads", "Ads Specialist", true)
	testutil.InsertRoleMapping(t, s.DB, "Ads", "Ads Specialist", "Ads", "staff")
	// Direct snapshot inserts (final 90 and 70 → avg 80).
	for _, r := range []struct {
		id, staff string
		final     float64
	}{{"PERF-202606-0001", "EMP-K1", 90}, {"PERF-202606-0002", "EMP-K2", 70}} {
		if _, err := s.DB.ExecContext(bg,
			`INSERT INTO performance_snapshots (id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_by)
			 VALUES (?, ?, 'Ads', '2026-06-01', '2026-06-30', ?, 0, ?, '{"components":[]}', 'system')`,
			r.id, r.staff, r.final, r.final); err != nil {
			t.Fatal(err)
		}
	}
	roll, err := s.TeamRollup(bg, director("D"), AdsDivision, junePeriod)
	if err != nil {
		t.Fatalf("TeamRollup: %v", err)
	}
	if len(roll.Members) != 2 {
		t.Fatalf("members = %d, want 2", len(roll.Members))
	}
	if roll.TeamAverage == nil || math.Abs(*roll.TeamAverage-80) > 0.01 {
		t.Errorf("team average = %v, want 80", roll.TeamAverage)
	}
	// A Creative lead cannot view the Ads team.
	creativeLead := permission.Actor{EmployeeID: "CL", Role: permission.Role{Division: CreativeDivision, Level: permission.LevelLead}}
	if _, err := s.TeamRollup(bg, creativeLead, AdsDivision, junePeriod); !errors.Is(err, ErrForbidden) {
		t.Errorf("creative lead team view: want ErrForbidden, got %v", err)
	}
}

// ---- config: Σ≠100 rejected; gate Director-only ----

func TestConfigWeights(t *testing.T) {
	s := svc(t)
	// Σ ≠ 100 rejected.
	bad := map[string]float64{CompSpeedScore: 30, CompROASAttainment: 30, CompGMVImpact: 25, CompOptimizationActivity: 20} // 105
	if err := s.SetWeights(bg, director("D"), RoleAds, bad); !errors.Is(err, ErrWeightsNotHundred) {
		t.Errorf("Σ=105: want ErrWeightsNotHundred, got %v", err)
	}
	// Valid Σ=100 accepted by Director.
	good := map[string]float64{CompSpeedScore: 25, CompROASAttainment: 30, CompGMVImpact: 25, CompOptimizationActivity: 20}
	if err := s.SetWeights(bg, director("D"), RoleAds, good); err != nil {
		t.Errorf("valid weights: %v", err)
	}
	// Non-director rejected.
	if err := s.SetWeights(bg, adsLead("L"), RoleAds, good); !errors.Is(err, ErrConfigForbidden) {
		t.Errorf("ads lead config: want ErrConfigForbidden, got %v", err)
	}
	// Bad role type rejected.
	if err := s.SetWeights(bg, director("D"), "Sales", good); !errors.Is(err, ErrBadRoleType) {
		t.Errorf("bad role type: want ErrBadRoleType, got %v", err)
	}
	// Audit row recorded.
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE entity_type='perf_kpi_weights' AND action='weights_set'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 1 {
		t.Error("weights_set audit row missing")
	}
}
