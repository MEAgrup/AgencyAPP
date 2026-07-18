package module15_portal

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module11_board"
	"github.com/meagrup/agencyapp/backend/internal/module12_task"
	"github.com/meagrup/agencyapp/backend/internal/module14_performance"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var bg = context.Background()

// Fixed clock: WIB 2026-07-17. Current (running) month = July 2026.
var nowJul = time.Date(2026, 7, 17, 5, 0, 0, 0, time.UTC)

// ---- actors ----

func adsStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Ads", Level: permission.LevelStaff}}
}
func adsLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Ads", Level: permission.LevelLead}}
}
func creativeStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Creative", Level: permission.LevelStaff}}
}
func creativeLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Creative", Level: permission.LevelLead}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func odActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}

// ---- service + fixtures ----

func newSvc(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	eng := statemachine.New()
	return &Service{
		DB:    d,
		Board: &module11_board.Service{DB: d},
		Perf:  &module14_performance.Service{DB: d},
		Task:  &module12_task.Service{DB: d, Engine: eng, Catalog: notification.NewCatalog()},
	}, d
}

func insClient(t *testing.T, d *sql.DB, id, amID string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		   total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00', 'EMP-BUDI', 'EMP-BUDI', NOW(), ?, 'TEST')`,
		id, id, amID)
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

// insBrief inserts a Brief in a given status/division/pic with an optional due date.
func insBrief(t *testing.T, d *sql.DB, id, svcID, division, pic, status, due string) {
	t.Helper()
	var dueArg any
	if due != "" {
		dueArg = due
	}
	_, err := d.ExecContext(bg,
		`INSERT INTO briefs (id, service_id, title, status, assigned_division, assigned_pic, due_date, sla_target_hours, created_by)
		 VALUES (?, ?, 'B', ?, ?, ?, ?, 10, 'TEST')`, id, svcID, status, division, pic, dueArg)
	if err != nil {
		t.Fatalf("insBrief: %v", err)
	}
}

func insAsset(t *testing.T, d *sql.DB, id, briefID, pic, status string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, status, assigned_pic, sla_target_hours, created_by)
		 VALUES (?, ?, 'Product Video', 1, ?, ?, 10, 'TEST')`, id, briefID, status, pic)
	if err != nil {
		t.Fatalf("insAsset: %v", err)
	}
}

func insCHR(t *testing.T, d *sql.DB, id, clientID, periodStart string, final float64, band, componentsJSON string) {
	t.Helper()
	end := periodStart[:8] + "28"
	_, err := d.ExecContext(bg,
		`INSERT INTO client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
		 VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'system')`,
		id, clientID, periodStart, end, final, band, componentsJSON)
	if err != nil {
		t.Fatalf("insCHR: %v", err)
	}
}

// ---- Staff landing: SLA-risk sort + running score (never stored) ----

func TestStaffLanding_SortAndRunningScoreNotStored(t *testing.T) {
	s, d := newSvc(t)
	testutil.InsertEmployee(t, d, "EMP-ADS", "Adi", "adi@mea.id", "Ads", "Ads Specialist", true)
	testutil.InsertRoleMapping(t, d, "Ads", "Ads Specialist", "Ads", "staff")
	insClient(t, d, "CLI-1", "EMP-AM")
	insService(t, d, "SVC-1", "CLI-1")
	// Three open Ads tasks for EMP-ADS: overdue, upcoming, no-due — must sort in that order.
	insBrief(t, d, "BRF-SOON", "SVC-1", "Ads", "EMP-ADS", "[In Progress]", "2026-08-01")
	insBrief(t, d, "BRF-OVERDUE", "SVC-1", "Ads", "EMP-ADS", "[In Progress]", "2020-01-01")
	insBrief(t, d, "BRF-NODUE", "SVC-1", "Ads", "EMP-ADS", "[In Progress]", "")
	// A DONE task must be excluded from the open list.
	insBrief(t, d, "BRF-DONE", "SVC-1", "Ads", "EMP-ADS", "[Approved]", "2026-08-05")

	before := countSnapshots(t, d)

	land, err := s.StaffLandingFor(bg, adsStaff("EMP-ADS"), nowJul)
	if err != nil {
		t.Fatalf("StaffLandingFor: %v", err)
	}
	if len(land.OpenTasks) != 3 {
		t.Fatalf("open tasks = %d, want 3 (Done excluded)", len(land.OpenTasks))
	}
	order := []string{land.OpenTasks[0].ID, land.OpenTasks[1].ID, land.OpenTasks[2].ID}
	want := []string{"BRF-OVERDUE", "BRF-SOON", "BRF-NODUE"}
	for i := range want {
		if order[i] != want[i] {
			t.Errorf("SLA-risk order[%d] = %s, want %s (full: %v)", i, order[i], want[i], order)
		}
	}
	// Running score present, is a live preview, carries the mandatory breakdown.
	if land.RunningScore == nil {
		t.Fatal("running score should be present for a profiled Ads staffer")
	}
	if !land.RunningScore.Preview {
		t.Error("running score must be a live preview")
	}
	if land.RunningScore.RoleType != module14_performance.RoleAds {
		t.Errorf("running score role = %q, want Ads", land.RunningScore.RoleType)
	}
	if len(land.RunningScore.Components) == 0 {
		t.Error("running score must carry the full component breakdown (Rule 9)")
	}
	// Running score is computed-on-read: NOTHING was inserted (parallel to Rule 10 M13).
	if after := countSnapshots(t, d); after != before {
		t.Errorf("performance_snapshots grew %d -> %d; running score must not be stored", before, after)
	}
}

// A staffer without a KPI Profile (e.g. Sales) still gets a landing — just no score.
func TestStaffLanding_NoProfileNoScore(t *testing.T) {
	s, d := newSvc(t)
	testutil.InsertEmployee(t, d, "EMP-SAL", "Sari", "sari@mea.id", "Sales", "Sales Executive", true)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	sales := permission.Actor{EmployeeID: "EMP-SAL", Role: permission.Role{Division: "Sales", Level: permission.LevelStaff}}
	land, err := s.StaffLandingFor(bg, sales, nowJul)
	if err != nil {
		t.Fatalf("StaffLandingFor: %v", err)
	}
	if land.RunningScore != nil {
		t.Error("Sales staff has no KPI Profile → running score must be nil, not an error")
	}
}

func countSnapshots(t *testing.T, d *sql.DB) int {
	t.Helper()
	var n int
	if err := d.QueryRow(`SELECT COUNT(*) FROM performance_snapshots`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ---- Lead block-approval queue: two sources, scoping, approve→[Blocked], reject ----

func TestTeamPortal_BlockQueueTwoSourcesAndApprove(t *testing.T) {
	s, d := newSvc(t)
	insClient(t, d, "CLI-1", "EMP-AM")
	insService(t, d, "SVC-1", "CLI-1")
	// An Ads Brief-as-task (source: brief) and a Creative Asset (source: asset), both [In Progress].
	insBrief(t, d, "BRF-ADS", "SVC-1", "Ads", "EMP-ADS", "[In Progress]", "2026-08-01")
	insBrief(t, d, "BRF-CRE", "SVC-1", "Creative", "EMP-CRE", "[In Progress]", "2026-08-01")
	insAsset(t, d, "AST-1", "BRF-CRE", "EMP-CRE", "[In Progress]")

	// Staff submit block requests (they cannot set [Blocked] themselves — Rule 10 / M12).
	briefReq, err := s.Task.SubmitBlockRequest(bg, adsStaff("EMP-ADS"), "BRF-ADS", "menunggu aset klien")
	if err != nil {
		t.Fatalf("SubmitBlockRequest (brief): %v", err)
	}
	assetReq, err := s.Task.SubmitAssetBlockRequest(bg, creativeStaff("EMP-CRE"), "AST-1", "menunggu revisi brief")
	if err != nil {
		t.Fatalf("SubmitAssetBlockRequest (asset): %v", err)
	}

	// Director sees BOTH sources.
	dq, err := s.Task.PendingBlockRequests(bg, director("D"))
	if err != nil {
		t.Fatalf("PendingBlockRequests (director): %v", err)
	}
	if got := sourcesOf(dq); !(got["brief"] && got["asset"]) || len(dq) != 2 {
		t.Fatalf("director queue = %+v, want one brief + one asset", dq)
	}

	// Ads lead sees ONLY the Ads brief request (division scope, mirrors M12 decide gate).
	al, err := s.Task.PendingBlockRequests(bg, adsLead("EMP-ADSLEAD"))
	if err != nil {
		t.Fatal(err)
	}
	if len(al) != 1 || al[0].Source != "brief" || al[0].EntityID != "BRF-ADS" {
		t.Fatalf("ads lead queue = %+v, want only the Ads brief request", al)
	}
	// Creative lead sees only the asset request.
	cl, _ := s.Task.PendingBlockRequests(bg, creativeLead("EMP-CRELEAD"))
	if len(cl) != 1 || cl[0].Source != "asset" || cl[0].EntityID != "AST-1" {
		t.Fatalf("creative lead queue = %+v, want only the asset request", cl)
	}
	// A staffer (non-lead) has an empty queue.
	if sq, _ := s.Task.PendingBlockRequests(bg, adsStaff("EMP-ADS")); len(sq) != 0 {
		t.Errorf("staff queue = %+v, want empty", sq)
	}

	// The full Team Portal aggregate surfaces the queue + rollup + client shortcuts.
	team, err := s.TeamPortalFor(bg, adsLead("EMP-ADSLEAD"), "", "")
	if err != nil {
		t.Fatalf("TeamPortalFor: %v", err)
	}
	if len(team.BlockQueue) != 1 || team.BlockQueue[0].EntityID != "BRF-ADS" {
		t.Errorf("team block queue = %+v, want the Ads brief request", team.BlockQueue)
	}
	if len(team.Clients) != 1 || team.Clients[0].ClientID != "CLI-1" {
		t.Errorf("team client shortcuts = %+v, want CLI-1", team.Clients)
	}

	// Approve end-to-end: delegate to M12 decide → engine drives [In Progress] -> [Blocked].
	if err := s.Task.ApproveBlockRequest(bg, adsLead("EMP-ADSLEAD"), "BRF-ADS", briefReq.ID); err != nil {
		t.Fatalf("ApproveBlockRequest: %v", err)
	}
	if st := statusOf(t, d, "briefs", "BRF-ADS"); st != "[Blocked]" {
		t.Errorf("BRF-ADS status = %q, want [Blocked] after approve", st)
	}
	// The approved request is no longer pending in the queue.
	if al2, _ := s.Task.PendingBlockRequests(bg, adsLead("EMP-ADSLEAD")); len(al2) != 0 {
		t.Errorf("ads lead queue after approve = %+v, want empty", al2)
	}

	// Reject WITHOUT a reason (OA-6): asset stays in its prior status, request closed.
	if err := s.Task.RejectAssetBlockRequest(bg, creativeLead("EMP-CRELEAD"), "AST-1", assetReq.ID); err != nil {
		t.Fatalf("RejectAssetBlockRequest: %v", err)
	}
	if st := statusOf(t, d, "assets", "AST-1"); st != "[In Progress]" {
		t.Errorf("AST-1 status = %q, want unchanged [In Progress] after reject", st)
	}
	if cl2, _ := s.Task.PendingBlockRequests(bg, creativeLead("EMP-CRELEAD")); len(cl2) != 0 {
		t.Errorf("creative lead queue after reject = %+v, want empty", cl2)
	}
}

func sourcesOf(q []module12_task.PendingBlockRequest) map[string]bool {
	m := map[string]bool{}
	for _, r := range q {
		m[r.Source] = true
	}
	return m
}

func statusOf(t *testing.T, d *sql.DB, table, id string) string {
	t.Helper()
	var st string
	if err := d.QueryRow("SELECT status FROM "+table+" WHERE id = ?", id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// ---- Team Portal gate: staff denied ----

func TestTeamPortal_StaffDenied(t *testing.T) {
	s, _ := newSvc(t)
	if _, err := s.TeamPortalFor(bg, adsStaff("EMP-ADS"), "", ""); !errors.Is(err, ErrForbidden) {
		t.Errorf("staff /team: want ErrForbidden, got %v", err)
	}
	// A lead cannot view another division's team.
	if _, err := s.TeamPortalFor(bg, adsLead("L"), "Creative", ""); !errors.Is(err, ErrForbidden) {
		t.Errorf("ads lead viewing Creative team: want ErrForbidden, got %v", err)
	}
}

// ---- Management Dashboard: band sort/filter, trend direction, dragging component ----

func TestManagementDashboard_SortTrendDragging(t *testing.T) {
	s, d := newSvc(t)
	insClient(t, d, "CLI-A", "EMP-AM1")
	insClient(t, d, "CLI-B", "EMP-AM2")
	insClient(t, d, "CLI-C", "EMP-AM1")
	// CLI-A: At Risk, dropped from 70 (prev) to 50 (latest) → down; roas is the dragging (40) sub-score.
	insCHR(t, d, "CHR-202605-0001", "CLI-A", "2026-05-01", 70, "Watch", `[]`)
	insCHR(t, d, "CHR-202606-0001", "CLI-A", "2026-06-01", 50, "At Risk",
		`[{"name":"gmv_growth","included":true,"capped":80},{"name":"roas_attainment","included":true,"capped":40},{"name":"complaints","included":false}]`)
	// CLI-B: Healthy, rose 85 → 90 → up.
	insCHR(t, d, "CHR-202605-0002", "CLI-B", "2026-05-01", 85, "Healthy", `[]`)
	insCHR(t, d, "CHR-202606-0002", "CLI-B", "2026-06-01", 90, "Healthy",
		`[{"name":"gmv_growth","included":true,"capped":90}]`)
	// CLI-C: Watch, single snapshot → flat.
	insCHR(t, d, "CHR-202606-0003", "CLI-C", "2026-06-01", 65, "Watch",
		`[{"name":"payment_timeliness","included":true,"capped":60}]`)

	dash, err := s.ManagementDashboardFor(bg, director("D"), "", "", "")
	if err != nil {
		t.Fatalf("ManagementDashboardFor: %v", err)
	}
	if len(dash.Rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(dash.Rows))
	}
	// Default sort: At Risk first, then Watch, then Healthy.
	if dash.Rows[0].ClientID != "CLI-A" || dash.Rows[1].ClientID != "CLI-C" || dash.Rows[2].ClientID != "CLI-B" {
		t.Fatalf("band sort = [%s %s %s], want [CLI-A CLI-C CLI-B]",
			dash.Rows[0].ClientID, dash.Rows[1].ClientID, dash.Rows[2].ClientID)
	}
	a := dash.Rows[0]
	if a.Band != "At Risk" || a.TrendDirection != TrendDown {
		t.Errorf("CLI-A band/trend = %s/%s, want At Risk/down", a.Band, a.TrendDirection)
	}
	if a.DraggingComponent != "roas_attainment" || a.DraggingCapped == nil || *a.DraggingCapped != 40 {
		t.Errorf("CLI-A dragging = %s/%v, want roas_attainment/40", a.DraggingComponent, a.DraggingCapped)
	}
	if dash.Rows[2].TrendDirection != TrendUp {
		t.Errorf("CLI-B trend = %s, want up", dash.Rows[2].TrendDirection)
	}
	if dash.Rows[1].TrendDirection != TrendFlat {
		t.Errorf("CLI-C trend = %s, want flat (single snapshot)", dash.Rows[1].TrendDirection)
	}
	if dash.Rows[0].SnapshotID == "" {
		t.Error("drill-through snapshot id must be present")
	}

	// Filter by band → only At Risk.
	only, err := s.ManagementDashboardFor(bg, director("D"), "At Risk", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(only.Rows) != 1 || only.Rows[0].ClientID != "CLI-A" {
		t.Errorf("band filter = %+v, want only CLI-A", only.Rows)
	}
	// Filter by AM.
	byAM, err := s.ManagementDashboardFor(bg, director("D"), "", "EMP-AM1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(byAM.Rows) != 2 {
		t.Errorf("AM filter rows = %d, want 2 (CLI-A + CLI-C)", len(byAM.Rows))
	}
}

// ---- Management Dashboard gate: Director + OD only; layered roles ----

func TestManagementDashboard_Gate(t *testing.T) {
	s, d := newSvc(t)
	insClient(t, d, "CLI-A", "EMP-AM")
	insCHR(t, d, "CHR-202606-0001", "CLI-A", "2026-06-01", 55, "At Risk", `[]`)

	// Director and OD may read.
	for _, a := range []permission.Actor{director("D"), odActor("O")} {
		if _, err := s.ManagementDashboardFor(bg, a, "", "", ""); err != nil {
			t.Errorf("actor %+v: %v", a.Role, err)
		}
	}
	// Layered OD/Director on top of a division account still passes (OD flag set).
	layeredOD := permission.Actor{EmployeeID: "OKFA", Role: permission.Role{Division: "Account", Level: permission.LevelStaff, OD: true}}
	if _, err := s.ManagementDashboardFor(bg, layeredOD, "", "", ""); err != nil {
		t.Errorf("layered OD: %v", err)
	}
	// Staff and a plain division lead are denied (Rule 11).
	if _, err := s.ManagementDashboardFor(bg, adsStaff("EMP-ADS"), "", "", ""); !errors.Is(err, ErrForbidden) {
		t.Errorf("staff /management: want ErrForbidden, got %v", err)
	}
	if _, err := s.ManagementDashboardFor(bg, adsLead("L"), "", "", ""); !errors.Is(err, ErrForbidden) {
		t.Errorf("lead /management: want ErrForbidden, got %v", err)
	}
}
