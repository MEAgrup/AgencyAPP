package module13_health

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var bg = context.Background()

// Fixed clock: WIB 2026-07-17 12:00 → most-recently CLOSED month = June 2026.
var nowJul = time.Date(2026, 7, 17, 5, 0, 0, 0, time.UTC)

const junePeriod = "202606"

// ---- actor helpers ----

func amActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func odActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}
func creativeStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Creative", Level: permission.LevelStaff}}
}

func svc(t *testing.T) *Service {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Catalog: notification.NewCatalog()}
}

// ---- fixture inserters ----

func insClient(t *testing.T, d *sql.DB, id, amID, baseline, target, total string, createdAt time.Time) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		   total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_at, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', ?, ?, ?, 'EMP-BUDI', 'EMP-BUDI', NOW(), ?, ?, 'TEST')`,
		id, id, baseline, target, total, amID, createdAt.UTC())
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

func insBrief(t *testing.T, d *sql.DB, id, svcID, division string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO briefs (id, service_id, title, status, assigned_division, created_by)
		 VALUES (?, ?, 'B', '[In Progress]', ?, 'TEST')`, id, svcID, division)
	if err != nil {
		t.Fatalf("insBrief: %v", err)
	}
}

// insTask inserts an asset in [Approved] with an SLA, then writes its immutable
// transition log: [In Progress]@start, `revisions` × [Revision Requested], and
// [Approved]@(start+turnaround h). Speed Score = turnaround/sla × 100.
func insTask(t *testing.T, d *sql.DB, id, briefID string, seq int, sla, turnaroundH float64, revisions int, start time.Time) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, status, sla_target_hours, created_by)
		 VALUES (?, ?, 'Video', ?, '[Approved]', ?, 'TEST')`, id, briefID, seq, sla)
	if err != nil {
		t.Fatalf("insTask: %v", err)
	}
	insAudit(t, d, "asset", id, "transition:[To Do]->[In Progress]", start)
	for i := 0; i < revisions; i++ {
		insAudit(t, d, "asset", id, "transition:[In Review]->[Revision Requested]", start.Add(time.Duration(i+1)*time.Minute))
	}
	insAudit(t, d, "asset", id, "transition:[In Review]->[Approved]", start.Add(time.Duration(turnaroundH*float64(time.Hour))))
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

func insAdCampaign(t *testing.T, d *sql.DB, id, briefID, clientID, status, targetKPI string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
		 VALUES (?, ?, ?, 'Shopee Ads', 'Conversion', '100000000.00', '2026-06-01', '2026-12-31', ?, ?, 'TEST')`,
		id, briefID, clientID, targetKPI, status)
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

func insTransaction(t *testing.T, d *sql.DB, id, clientID string) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, 'Termin', '10000000.00', '[Terverifikasi]', 'TEST')`, id, clientID)
	if err != nil {
		t.Fatalf("insTransaction: %v", err)
	}
}

func insInstallment(t *testing.T, d *sql.DB, id, trxID string, no int, dueDate string, overdue bool) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
		 VALUES (?, ?, ?, '5000000.00', ?, '[Terverifikasi]', 'TEST')`, id, trxID, no, dueDate)
	if err != nil {
		t.Fatalf("insInstallment: %v", err)
	}
	if overdue {
		insAudit(t, d, "installment", id, "transition:[Belum Jatuh Tempo]->[Jatuh Tempo]",
			time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC))
	}
}

func insComplaint(t *testing.T, d *sql.DB, id, clientID, severity string, at time.Time) {
	t.Helper()
	_, err := d.ExecContext(bg,
		`INSERT INTO complaints (id, client_id, source, description, severity, status, created_at, created_by)
		 VALUES (?, ?, 'WhatsApp (AM-logged)', 'x', ?, '[Open]', ?, 'TEST')`, id, clientID, severity, at.UTC())
	if err != nil {
		t.Fatalf("insComplaint: %v", err)
	}
}

// alphaDigital builds the full PRD §4 worked example for one client (June 2026).
func alphaDigital(t *testing.T, d *sql.DB, clientID, amID string) {
	t.Helper()
	// GMV: 50M → 80M → 62M ⇒ raw 40. Onboarded April (no grace for June).
	insClient(t, d, clientID, amID, "50000000.00", "80000000.00", "62000000.00",
		time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	svcID := "SVC-" + clientID
	insService(t, d, svcID, clientID)

	// Creative brief + 10 tasks: 9 within SLA (speed 50%), 1 over (speed 200%) ⇒
	// Task Completion 90; revisions summing to 12 ⇒ avg 1.2 ⇒ Revision Burden 76.
	crBrief := "BRF-CR-" + clientID
	insBrief(t, d, crBrief, svcID, "Creative")
	start := time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)
	revs := []int{2, 2, 1, 1, 1, 1, 1, 1, 1, 1} // Σ = 12
	for i := 0; i < 10; i++ {
		turn := 5.0 // within SLA (sla 10 ⇒ speed 50%)
		if i == 9 {
			turn = 20.0 // over SLA ⇒ speed 200%
		}
		insTask(t, d, "AST-"+clientID+"-"+string(rune('A'+i)), crBrief, i+1, 10, turn, revs[i], start)
	}

	// ROAS: active campaign, target 5.0x, actual 4.2x (spend 100M, gmv 420M) ⇒ 84.
	adBrief := "BRF-AD-" + clientID
	insBrief(t, d, adBrief, svcID, "Ads")
	adc := "ADC-" + clientID
	insAdCampaign(t, d, adc, adBrief, clientID, "[Active]", "ROAS 5")
	insMetricEntry(t, d, "MTR-"+clientID, adc, "2026-06-05", "100000000.00", "420000000.00")

	// Payment: 1 installment due in June, on time ⇒ 100.
	trx := "TRX-" + clientID
	insTransaction(t, d, trx, clientID)
	insInstallment(t, d, "INST-"+clientID, trx, 1, "2026-06-15", false)

	// Complaints: 1 Low logged in June ⇒ 95.
	insComplaint(t, d, "CPL-"+clientID, clientID, "Low", time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
}

func compByName(comps []Component, name string) Component {
	for _, c := range comps {
		if c.Name == name {
			return c
		}
	}
	return Component{}
}

// ---- worked example end to end ----

func TestSnapshot_AlphaDigitalEndToEnd(t *testing.T) {
	s := svc(t)
	alphaDigital(t, s.DB, "CLI-ALPHA", "EMP-AM")

	res, err := s.RunSnapshotJob(bg, nowJul)
	if err != nil {
		t.Fatalf("RunSnapshotJob: %v", err)
	}
	if res.Period != junePeriod || res.SnapshotsMade != 1 {
		t.Fatalf("scan result = %+v, want period 202606 / 1 snapshot", res)
	}

	snap, err := s.GetSnapshot(bg, director("D"), "CLI-ALPHA", junePeriod)
	if err != nil {
		t.Fatalf("GetSnapshot: %v", err)
	}
	if snap.FinalHealthScore == nil {
		t.Fatal("final score nil")
	}
	if want := 6710.0 / 90.0; math.Abs(*snap.FinalHealthScore-math.Round(want*1000)/1000) > 0.01 {
		t.Errorf("final score = %v, want ≈ 74.56", *snap.FinalHealthScore)
	}
	if snap.Band != BandWatch {
		t.Errorf("band = %q, want Watch", snap.Band)
	}
	if !snap.ROASToggleState {
		t.Error("ROAS toggle state should be true (active Ads service, no override)")
	}
	// Spot-check the recomputed sub-scores (raw uncapped preserved, Rule 6).
	checks := map[string]float64{
		CompGMVGrowth: 40, CompROASAttainment: 84, CompTaskCompletion: 90,
		CompRevisionBurden: 76, CompComplaints: 95, CompPaymentTimeliness: 100,
	}
	for name, want := range checks {
		c := compByName(snap.Components, name)
		if !c.Included || c.Raw == nil || math.Abs(*c.Raw-want) > 0.001 {
			t.Errorf("component %s raw = %v, want %v (included=%v)", name, c.Raw, want, c.Included)
		}
	}
	if sat := compByName(snap.Components, CompSatisfaction); sat.Included {
		t.Error("Satisfaction must always be excluded (Rule 2)")
	}
}

// ---- idempotency ----

func TestSnapshot_SweepIdempotent(t *testing.T) {
	s := svc(t)
	alphaDigital(t, s.DB, "CLI-ALPHA", "EMP-AM")
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	res, err := s.RunSnapshotJob(bg, nowJul)
	if err != nil {
		t.Fatal(err)
	}
	if res.SnapshotsMade != 0 {
		t.Fatalf("second sweep made %d snapshots, want 0 (idempotent)", res.SnapshotsMade)
	}
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM client_health_snapshots WHERE client_id='CLI-ALPHA'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("snapshot count = %d, want 1", n)
	}
}

// ---- immutability (house rule 3 / Rule 9, storage triggers) ----

func TestSnapshot_Immutable(t *testing.T) {
	s := svc(t)
	alphaDigital(t, s.DB, "CLI-ALPHA", "EMP-AM")
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := s.DB.QueryRow(`SELECT id FROM client_health_snapshots WHERE client_id='CLI-ALPHA'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE client_health_snapshots SET band='Healthy' WHERE id=?`, id); err == nil {
		t.Error("UPDATE on snapshot should be blocked by the immutability trigger")
	}
	if _, err := s.DB.Exec(`DELETE FROM client_health_snapshots WHERE id=?`, id); err == nil {
		t.Error("DELETE on snapshot should be blocked by the immutability trigger")
	}
}

// ---- band drop emission (Rule 12), fire-once ----

func TestSnapshot_BandDropEmitsOnce(t *testing.T) {
	s := svc(t)
	// Account SPV (lead) so leadsOfDivision("Account") resolves a recipient.
	testutil.InsertEmployee(t, s.DB, "EMP-SPV", "Spv", "spv@x", "Account", "SPV", true)
	testutil.InsertRoleMapping(t, s.DB, "Account", "SPV", "Account", "lead")

	alphaDigital(t, s.DB, "CLI-ALPHA", "EMP-AM") // June → Watch
	// Pre-existing MAY snapshot in a healthier band → June is a drop.
	if _, err := s.DB.Exec(
		`INSERT INTO client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
		 VALUES ('CHR-202605-0001','CLI-ALPHA','2026-05-01','2026-05-31', 90, 'Healthy', 1, '[]', 'system')`); err != nil {
		t.Fatal(err)
	}

	res, err := s.RunSnapshotJob(bg, nowJul)
	if err != nil {
		t.Fatal(err)
	}
	if res.BandDropsFlagged != 1 {
		t.Fatalf("band drops flagged = %d, want 1", res.BandDropsFlagged)
	}
	notes, err := notification.List(bg, s.DB, "EMP-SPV", false)
	if err != nil {
		t.Fatal(err)
	}
	drops := 0
	for _, n := range notes {
		if n.EventType == string(notification.EvClientBandDrop) {
			drops++
		}
	}
	if drops != 1 {
		t.Fatalf("EvClientBandDrop notifications = %d, want 1", drops)
	}
	// Re-run: no new snapshot ⇒ no new emission (fire-once by construction).
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	notes2, _ := notification.List(bg, s.DB, "EMP-SPV", false)
	if len(notes2) != len(notes) {
		t.Fatalf("re-run added notifications: %d → %d", len(notes), len(notes2))
	}
}

// ---- grace period (Rule 8) ----

func TestSnapshot_GracePeriodExcludesGMV(t *testing.T) {
	s := svc(t)
	// Onboarded mid-June ⇒ first full month is July ⇒ GMV excluded for June.
	insClient(t, s.DB, "CLI-NEW", "EMP-AM", "50000000.00", "80000000.00", "62000000.00",
		time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC))
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}
	snap, err := s.GetSnapshot(bg, director("D"), "CLI-NEW", junePeriod)
	if err != nil {
		t.Fatal(err)
	}
	if g := compByName(snap.Components, CompGMVGrowth); g.Included {
		t.Errorf("GMV should be excluded during grace, got included with raw %v", g.Raw)
	}
}

// ---- div-zero / empty data → excluded + redistribute, never an error ----

func TestSnapshot_DivZeroExcludesNotErrors(t *testing.T) {
	s := svc(t)
	// Target == Baseline (zero denom), no Ads, no tasks, no installments, no
	// complaints ⇒ only Complaints available (100) ⇒ score 100, band Healthy.
	insClient(t, s.DB, "CLI-FLAT", "EMP-AM", "50000000.00", "50000000.00", "60000000.00",
		time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatalf("sweep errored on div-zero client: %v", err)
	}
	snap, err := s.GetSnapshot(bg, director("D"), "CLI-FLAT", junePeriod)
	if err != nil {
		t.Fatal(err)
	}
	if g := compByName(snap.Components, CompGMVGrowth); g.Included {
		t.Error("GMV should be excluded when Target==Baseline")
	}
	if snap.FinalHealthScore == nil || *snap.FinalHealthScore != 100 {
		t.Errorf("final score = %v, want 100 (only Complaints available)", snap.FinalHealthScore)
	}
	if snap.Band != BandHealthy {
		t.Errorf("band = %q, want Healthy", snap.Band)
	}
}

// ---- ROAS toggle (Rule 13 / §5.4) ----

func TestROASToggle_OverrideExcludesROAS(t *testing.T) {
	s := svc(t)
	alphaDigital(t, s.DB, "CLI-ALPHA", "EMP-AM")

	// Default: active Ads ⇒ effective true.
	tg, err := s.GetROASToggle(bg, amActor("EMP-AM"), "CLI-ALPHA")
	if err != nil {
		t.Fatal(err)
	}
	if !tg.Effective || tg.Override != nil {
		t.Fatalf("default toggle = %+v, want effective true / no override", tg)
	}

	// AM toggles OFF.
	off := false
	tg, err = s.SetROASToggle(bg, amActor("EMP-AM"), "CLI-ALPHA", &off)
	if err != nil {
		t.Fatalf("SetROASToggle: %v", err)
	}
	if tg.Override == nil || *tg.Override != false || tg.Effective {
		t.Fatalf("after OFF: %+v, want override false / effective false", tg)
	}
	// Preview now excludes ROAS and redistributes.
	prev, err := s.Preview(bg, amActor("EMP-AM"), "CLI-ALPHA", nowJul)
	if err != nil {
		t.Fatal(err)
	}
	if r := compByName(prev.Components, CompROASAttainment); r.Included {
		t.Error("ROAS should be excluded after toggle OFF")
	}
	// Audit row recorded.
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type='client' AND entity_id='CLI-ALPHA' AND action='roas_health_toggle_set'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("toggle audit rows = %d, want 1", n)
	}
}

func TestROASToggle_NoAdsIsStructurallyNA(t *testing.T) {
	s := svc(t)
	insClient(t, s.DB, "CLI-NOADS", "EMP-AM", "50000000.00", "80000000.00", "62000000.00",
		time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	// Even with an explicit ON override, no Ads service ⇒ structurally N/A.
	on := true
	tg, err := s.SetROASToggle(bg, accountLead("EMP-LEAD"), "CLI-NOADS", &on)
	if err != nil {
		t.Fatal(err)
	}
	if tg.Effective {
		t.Errorf("no-Ads client effective = true, want false (structural N/A, Rule 13)")
	}
}

// ---- visibility (Rule 11) + scan gate ----

func TestVisibility_And_ScanGate(t *testing.T) {
	s := svc(t)
	alphaDigital(t, s.DB, "CLI-ALPHA", "EMP-AM")
	if _, err := s.RunSnapshotJob(bg, nowJul); err != nil {
		t.Fatal(err)
	}

	// Owning AM sees it; a different AM gets ErrNotFound (own-book only).
	if _, err := s.GetSnapshot(bg, amActor("EMP-AM"), "CLI-ALPHA", junePeriod); err != nil {
		t.Errorf("owning AM: %v", err)
	}
	if _, err := s.GetSnapshot(bg, amActor("EMP-OTHER"), "CLI-ALPHA", junePeriod); !errors.Is(err, ErrNotFound) {
		t.Errorf("non-owner AM: want ErrNotFound, got %v", err)
	}
	// Account lead (division-wide), OD (read), Director (full) all see it.
	for _, a := range []permission.Actor{accountLead("L"), odActor("O"), director("D")} {
		if _, err := s.GetSnapshot(bg, a, "CLI-ALPHA", junePeriod); err != nil {
			t.Errorf("actor %+v: %v", a.Role, err)
		}
	}
	// A non-Account execution staffer has no scope.
	if _, err := s.GetSnapshot(bg, creativeStaff("C"), "CLI-ALPHA", junePeriod); !errors.Is(err, ErrForbidden) {
		t.Errorf("creative staff: want ErrForbidden, got %v", err)
	}

	// Scan gate: Account/Director may run; OD (read-only) and other divisions may not.
	if _, err := s.RunScan(bg, accountLead("L"), nowJul); err != nil {
		t.Errorf("account lead scan: %v", err)
	}
	if _, err := s.RunScan(bg, director("D"), nowJul); err != nil {
		t.Errorf("director scan: %v", err)
	}
	if _, err := s.RunScan(bg, odActor("O"), nowJul); !errors.Is(err, ErrScanForbidden) {
		t.Errorf("OD scan: want ErrScanForbidden, got %v", err)
	}
	if _, err := s.RunScan(bg, creativeStaff("C"), nowJul); !errors.Is(err, ErrScanForbidden) {
		t.Errorf("creative scan: want ErrScanForbidden, got %v", err)
	}
}
