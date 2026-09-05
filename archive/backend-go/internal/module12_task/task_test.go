package module12_task

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

const amID = "EMP-AM"

var ctx = context.Background()

// ---- actor helpers ----

func divisionStaff(div, id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: div, Level: permission.LevelStaff}}
}
func divisionLead(div, id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: div, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func od(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}

// ---- fixtures ----

func setup(t *testing.T) (*Service, *module6_account.Service) {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	eng := statemachine.New()
	m6 := &module6_account.Service{DB: d, Engine: eng}
	return &Service{DB: d, Engine: eng, Account: m6}, m6
}

// newBrief creates a released client + owner AM (EMP-AM) + Direct service, then
// mints a real Brief in [To Do] for `div` via module6_account.CreateBrief.
func newBrief(t *testing.T, s *Service, m6 *module6_account.Service, suffix, div string) (briefID, svcID string) {
	t.Helper()
	clientID, svcID := "CLI-"+suffix, "SVC-"+suffix
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
		         'EMP-BUDI', 'EMP-BUDI', NOW(), ?, 'TEST')`, clientID, clientID, amID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name,
		   standard_price, commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-X', 1, 'TikTok Shop Full Management', '10000000.00', 'rule', '[Awaiting Onboarding]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatal(err)
	}
	dt := "Product Video"
	if div == DivisionLiveStream {
		dt = "Live Stream Session"
	}
	b, err := m6.CreateBrief(ctx, accountStaff(amID), svcID, module6_account.BriefInput{
		Title: "T " + suffix, AssignedDivision: div, DeliverableType: dt,
		QuantityTarget: 1, DueDate: "2026-08-30", Priority: "High",
	})
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	return b.ID, svcID
}

func briefStatus(t *testing.T, s *Service, id string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRow(`SELECT status FROM briefs WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func serviceStatus(t *testing.T, s *Service, id string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRow(`SELECT status FROM services WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// ---- StartTask + Service advance (M6 §5 Flow 3 hook) ----

func TestStartTask_AdvancesService(t *testing.T) {
	s, m6 := setup(t)
	b, svc := newBrief(t, s, m6, "1", "Creative")
	if serviceStatus(t, s, svc) != "[Briefed]" {
		t.Fatalf("service = %q, want [Briefed]", serviceStatus(t, s, svc))
	}
	if _, err := s.StartTask(ctx, divisionStaff("Creative", "EMP-C"), b); err != nil {
		t.Fatalf("StartTask: %v", err)
	}
	if briefStatus(t, s, b) != StatusInProgress {
		t.Errorf("brief = %q, want [In Progress]", briefStatus(t, s, b))
	}
	if serviceStatus(t, s, svc) != "[In Execution]" {
		t.Errorf("service = %q, want [In Execution] (OnBriefLeavesToDo hook)", serviceStatus(t, s, svc))
	}
}

func TestStartTask_WrongStateAndNotFound(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	staff := divisionStaff("Creative", "EMP-C")
	if _, err := s.StartTask(ctx, staff, b); err != nil {
		t.Fatal(err)
	}
	// Second StartTask from [In Progress] is blocked (pinned source [To Do]).
	var be *statemachine.BlockedError
	if _, err := s.StartTask(ctx, staff, b); !errors.As(err, &be) {
		t.Errorf("double start: want BlockedError, got %v", err)
	}
	// ReworkTask from [In Progress] is blocked (pinned source [Revision Requested]).
	if _, err := s.ReworkTask(ctx, staff, b); !errors.As(err, &be) {
		t.Errorf("rework from in-progress: want BlockedError, got %v", err)
	}
	if _, err := s.StartTask(ctx, staff, "BRF-000000-0000"); !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("missing: want ErrTaskNotFound, got %v", err)
	}
}

func TestExecEdges_Permissions(t *testing.T) {
	s, m6 := setup(t)
	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"creative staff", divisionStaff("Creative", "EMP-C"), true},
		{"creative lead", divisionLead("Creative", "EMP-CL"), true},
		{"director", director("EMP-DIR"), true},
		{"other division", divisionStaff("Ads", "EMP-AD"), false},
		{"owning AM", accountStaff(amID), false},
		{"OD", od("EMP-OD"), false},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b, _ := newBrief(t, s, m6, "p"+string(rune('a'+i)), "Creative")
			_, err := s.StartTask(ctx, c.actor, b)
			if c.allow && err != nil {
				t.Fatalf("want allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrExecForbidden) {
				t.Fatalf("want ErrExecForbidden, got %v", err)
			}
		})
	}
}

// TestExecEdges_PICRestriction: once a PIC is assigned, a different staff member
// of the same division cannot drive the Task; the PIC and the lead still can.
func TestExecEdges_PICRestriction(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	registerStaff(t, s, "EMP-PIC", "Creative")
	if err := s.AssignPIC(ctx, divisionLead("Creative", "EMP-CL"), b, "EMP-PIC"); err != nil {
		t.Fatalf("AssignPIC: %v", err)
	}
	// A different Creative staff is now denied.
	if _, err := s.StartTask(ctx, divisionStaff("Creative", "EMP-OTHER"), b); !errors.Is(err, ErrExecForbidden) {
		t.Errorf("non-PIC staff: want ErrExecForbidden, got %v", err)
	}
	// The assigned PIC can.
	if _, err := s.StartTask(ctx, divisionStaff("Creative", "EMP-PIC"), b); err != nil {
		t.Errorf("PIC StartTask: %v", err)
	}
}

// ---- full flow to Approved + metrics ----

func TestFullFlow_Metrics(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	staff := divisionStaff("Creative", "EMP-C")
	lead := divisionLead("Creative", "EMP-CL")
	am := accountStaff(amID)

	if err := s.SetSLATarget(ctx, lead, b, 48); err != nil {
		t.Fatalf("SetSLATarget: %v", err)
	}
	mustExec(t, onlyErr(s.StartTask(ctx, staff, b)))
	mustExec(t, onlyErr(s.SubmitTask(ctx, staff, b)))
	if _, err := m6.ReviewBrief(ctx, am, b); err != nil {
		t.Fatal(err)
	}
	if _, err := m6.ApproveBrief(ctx, am, b); err != nil {
		t.Fatal(err)
	}
	m, err := s.TaskMetrics(ctx, lead, b)
	if err != nil {
		t.Fatal(err)
	}
	if m.Status != StatusApproved || m.TurnaroundHours == nil {
		t.Fatalf("metrics = %+v, want approved with turnaround", m)
	}
	if m.SpeedScorePct == nil {
		t.Errorf("speed should be computed once SLA set + approved, got N/A")
	}
	if *m.SLATargetHours != 48 {
		t.Errorf("sla = %v, want 48", m.SLATargetHours)
	}
}

// TestReworkTask: division reworks a Task after the AM requests a revision.
func TestReworkTask(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	staff := divisionStaff("Creative", "EMP-C")
	am := accountStaff(amID)
	mustExec(t, onlyErr(s.StartTask(ctx, staff, b)))
	mustExec(t, onlyErr(s.SubmitTask(ctx, staff, b)))
	if _, err := m6.ReviewBrief(ctx, am, b); err != nil {
		t.Fatal(err)
	}
	if _, err := m6.RequestBriefRevision(ctx, am, b, "perbaiki warna"); err != nil {
		t.Fatal(err)
	}
	if briefStatus(t, s, b) != StatusRevisionReq {
		t.Fatalf("status = %q, want [Revision Requested]", briefStatus(t, s, b))
	}
	if _, err := s.ReworkTask(ctx, staff, b); err != nil {
		t.Fatalf("ReworkTask: %v", err)
	}
	if briefStatus(t, s, b) != StatusInProgress {
		t.Errorf("status = %q, want [In Progress]", briefStatus(t, s, b))
	}
	// Metrics: revision count = 1, derived from the log.
	m, err := s.TaskMetrics(ctx, staff, b)
	if err != nil {
		t.Fatal(err)
	}
	if m.RevisionCount != 1 {
		t.Errorf("revision count = %d, want 1", m.RevisionCount)
	}
}

// ---- block-request flow (§5.3a) ----

func TestBlockFlow(t *testing.T) {
	s, m6 := setup(t)
	s.Catalog = notification.NewCatalog()
	registerLead(t, s, "EMP-CLEAD", "Creative")
	b, _ := newBrief(t, s, m6, "1", "Creative")
	staff := divisionStaff("Creative", "EMP-CSTAFF")
	lead := divisionLead("Creative", "EMP-CLEAD")
	mustExec(t, onlyErr(s.StartTask(ctx, staff, b)))

	// Staff cannot self-set [Blocked]: the only path is a lead-approved request.
	if err := s.ApproveBlockRequest(ctx, staff, b, "X"); !errors.Is(err, ErrBlockDecideForbidden) {
		t.Errorf("staff approve: want ErrBlockDecideForbidden, got %v", err)
	}
	// Reason mandatory.
	if _, err := s.SubmitBlockRequest(ctx, staff, b, "  "); !errors.Is(err, ErrBlockReasonRequired) {
		t.Errorf("empty reason: want ErrBlockReasonRequired, got %v", err)
	}
	req, err := s.SubmitBlockRequest(ctx, staff, b, "menunggu aset klien")
	if err != nil {
		t.Fatalf("SubmitBlockRequest: %v", err)
	}
	// Request alone does not change status (clock not paused yet).
	if briefStatus(t, s, b) != StatusInProgress {
		t.Errorf("status after request = %q, want still [In Progress]", briefStatus(t, s, b))
	}
	// Lead was notified (cataloged EvBlockRequestSubmitted).
	assertNotif(t, s, "EMP-CLEAD", notification.EvBlockRequestSubmitted, 1)

	// Lead approves -> [Blocked]; requester notified (EvBlockRequestDecided).
	if err := s.ApproveBlockRequest(ctx, lead, b, req.ID); err != nil {
		t.Fatalf("ApproveBlockRequest: %v", err)
	}
	if briefStatus(t, s, b) != StatusBlocked {
		t.Errorf("status = %q, want [Blocked]", briefStatus(t, s, b))
	}
	assertNotif(t, s, "EMP-CSTAFF", notification.EvBlockRequestDecided, 1)

	// Re-approving a resolved request fails.
	if err := s.ApproveBlockRequest(ctx, lead, b, req.ID); !errors.Is(err, ErrBlockRequestClosed) {
		t.Errorf("re-approve: want ErrBlockRequestClosed, got %v", err)
	}
	// Lead resumes -> [In Progress].
	if _, err := s.ResumeTask(ctx, lead, b); err != nil {
		t.Fatalf("ResumeTask: %v", err)
	}
	if briefStatus(t, s, b) != StatusInProgress {
		t.Errorf("status = %q, want [In Progress]", briefStatus(t, s, b))
	}
	// Staff cannot resume (requireLead).
	// Drive back to Blocked first via a fresh approved request.
	req2, _ := s.SubmitBlockRequest(ctx, staff, b, "lagi")
	if err := s.ApproveBlockRequest(ctx, lead, b, req2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResumeTask(ctx, staff, b); !errors.Is(err, ErrBlockDecideForbidden) {
		t.Errorf("staff resume: want ErrBlockDecideForbidden, got %v", err)
	}
}

func TestRejectBlockRequest(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	staff := divisionStaff("Creative", "EMP-CSTAFF")
	lead := divisionLead("Creative", "EMP-CL")
	mustExec(t, onlyErr(s.StartTask(ctx, staff, b)))
	req, err := s.SubmitBlockRequest(ctx, staff, b, "coba")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RejectBlockRequest(ctx, lead, b, req.ID); err != nil {
		t.Fatalf("RejectBlockRequest: %v", err)
	}
	if briefStatus(t, s, b) != StatusInProgress {
		t.Errorf("status = %q, want [In Progress] (reject does not block)", briefStatus(t, s, b))
	}
}

// ---- assign PIC / SLA (§5.3) ----

func TestAssignPICAndSLA(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	lead := divisionLead("Creative", "EMP-CL")
	registerStaff(t, s, "EMP-PIC", "Creative")

	// Non-lead cannot assign.
	if err := s.AssignPIC(ctx, divisionStaff("Creative", "EMP-C"), b, "EMP-PIC"); !errors.Is(err, ErrAssignForbidden) {
		t.Errorf("staff assign: want ErrAssignForbidden, got %v", err)
	}
	// Invalid PIC (wrong division / not staff).
	registerStaff(t, s, "EMP-ADS", "Ads")
	if err := s.AssignPIC(ctx, lead, b, "EMP-ADS"); !errors.Is(err, ErrInvalidPIC) {
		t.Errorf("cross-division PIC: want ErrInvalidPIC, got %v", err)
	}
	// Valid.
	if err := s.AssignPIC(ctx, lead, b, "EMP-PIC"); err != nil {
		t.Fatalf("AssignPIC: %v", err)
	}
	// SLA guards.
	if err := s.SetSLATarget(ctx, lead, b, 0); !errors.Is(err, ErrInvalidSLA) {
		t.Errorf("zero SLA: want ErrInvalidSLA, got %v", err)
	}
	if err := s.SetSLATarget(ctx, divisionStaff("Creative", "EMP-C"), b, 24); !errors.Is(err, ErrAssignForbidden) {
		t.Errorf("staff SLA: want ErrAssignForbidden, got %v", err)
	}
	if err := s.SetSLATarget(ctx, lead, b, 24); err != nil {
		t.Fatalf("SetSLATarget: %v", err)
	}
	// Audit rows exist for both.
	assertAudit(t, s, b, "pic_assigned")
	assertAudit(t, s, b, "sla_target_set")
}

// TestAssignPIC_LiveStreamRejected: a vendor-dispatched (Live Stream) Brief is not
// an execution Task — PIC/SLA are rejected (§2 Rule 3).
func TestAssignPIC_LiveStreamRejected(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", DivisionLiveStream)
	lead := divisionLead(DivisionLiveStream, "EMP-LSL")
	if err := s.AssignPIC(ctx, lead, b, "EMP-X"); !errors.Is(err, ErrNotATask) {
		t.Errorf("LS assign: want ErrNotATask, got %v", err)
	}
	if err := s.SetSLATarget(ctx, lead, b, 24); !errors.Is(err, ErrNotATask) {
		t.Errorf("LS sla: want ErrNotATask, got %v", err)
	}
	if _, err := s.StartTask(ctx, lead, b); !errors.Is(err, ErrNotATask) {
		t.Errorf("LS start: want ErrNotATask, got %v", err)
	}
}

// ---- read visibility (§6/§9.1) ----

func TestTaskMetrics_Visibility(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	allow := []permission.Actor{
		accountStaff(amID), accountLead("EMP-ALEAD"), od("EMP-OD"), director("EMP-DIR"),
		divisionStaff("Creative", "EMP-C"), divisionLead("Creative", "EMP-CL"),
	}
	for _, a := range allow {
		if _, err := s.TaskMetrics(ctx, a, b); err != nil {
			t.Errorf("%+v should view: %v", a.Role, err)
		}
	}
	deny := []permission.Actor{accountStaff("EMP-OTHER"), divisionStaff("Ads", "EMP-AD")}
	for _, a := range deny {
		if _, err := s.TaskMetrics(ctx, a, b); !errors.Is(err, ErrTaskViewForbidden) {
			t.Errorf("%+v must be denied, got %v", a.Role, err)
		}
	}
	if _, err := s.TaskMetrics(ctx, director("EMP-DIR"), "BRF-000000-0000"); !errors.Is(err, ErrTaskNotFound) {
		t.Errorf("missing: want ErrTaskNotFound, got %v", err)
	}
}

// TestTaskMetrics_RecomputeFromSeededLog seeds a controlled transition history
// (the Alpha Digital timeline) directly into the immutable audit log, then asserts
// TaskMetrics recomputes 54h / 112.5% purely from those timestamps (house rule 4).
func TestTaskMetrics_RecomputeFromSeededLog(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	// Set the SLA + drive the row to [Approved] out-of-band (this test isolates the
	// recompute-from-log path; the status/sla writes here are test scaffolding).
	if _, err := s.DB.Exec(`UPDATE briefs SET status='[Approved]', sla_target_hours=48 WHERE id=?`, b); err != nil {
		t.Fatal(err)
	}
	seed := []struct {
		to string
		at time.Time
	}{
		{StatusInProgress, time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)},
		{StatusSubmitted, time.Date(2026, 6, 2, 14, 0, 0, 0, time.UTC)},
		{StatusInReview, time.Date(2026, 6, 2, 14, 0, 0, 0, time.UTC)},
		{StatusRevisionReq, time.Date(2026, 6, 2, 16, 0, 0, 0, time.UTC)},
		{StatusInProgress, time.Date(2026, 6, 2, 17, 0, 0, 0, time.UTC)},
		{StatusSubmitted, time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)},
		{StatusInReview, time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)},
		{StatusApproved, time.Date(2026, 6, 3, 15, 0, 0, 0, time.UTC)},
	}
	prev := StatusToDo
	for _, e := range seed {
		if _, err := s.DB.Exec(
			`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
			 VALUES ('brief', ?, 'EMP-C', ?, ?, 'EMP-C')`,
			b, "transition:"+prev+"->"+e.to, e.at); err != nil {
			t.Fatal(err)
		}
		prev = e.to
	}
	m, err := s.TaskMetrics(ctx, director("EMP-DIR"), b)
	if err != nil {
		t.Fatal(err)
	}
	if !approx(m.TurnaroundHours, 54) || !approx(m.SpeedScorePct, 112.5) {
		t.Errorf("turnaround/speed = %v/%v, want 54/112.5", m.TurnaroundHours, m.SpeedScorePct)
	}
	if !approx(m.RevisionTurnaroundHours, 18) || m.RevisionCount != 1 {
		t.Errorf("revTA/count = %v/%d, want 18/1", m.RevisionTurnaroundHours, m.RevisionCount)
	}
}

// TestHistoryImmutable: block-request audit rows cannot be mutated (house rule 3).
func TestHistoryImmutable(t *testing.T) {
	s, m6 := setup(t)
	b, _ := newBrief(t, s, m6, "1", "Creative")
	staff := divisionStaff("Creative", "EMP-C")
	mustExec(t, onlyErr(s.StartTask(ctx, staff, b)))
	if _, err := s.SubmitBlockRequest(ctx, staff, b, "x"); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := s.DB.QueryRow(
		`SELECT id FROM audit_log WHERE entity_id=? AND action='block_request_submitted'`, b).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE audit_log SET action='x' WHERE id=?`, id); err == nil {
		t.Error("expected UPDATE on audit_log to be blocked")
	}
	if _, err := s.DB.Exec(`DELETE FROM audit_log WHERE id=?`, id); err == nil {
		t.Error("expected DELETE on audit_log to be blocked")
	}
}

// ---- small helpers ----

// onlyErr drops the Result so a transition call reads cleanly in an if-guard:
// if err := onlyErr(s.StartTask(...)); err != nil { ... }.
func onlyErr(_ statemachine.Result, err error) error { return err }

func mustExec(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("transition: %v", err)
	}
}

func registerStaff(t *testing.T, s *Service, id, div string) {
	t.Helper()
	testutil.InsertEmployee(t, s.DB, id, "Staff "+id, id+"@mea.id", div, div+" Staff", true)
	testutil.InsertRoleMapping(t, s.DB, div, div+" Staff", div, "staff")
}

func registerLead(t *testing.T, s *Service, id, div string) {
	t.Helper()
	testutil.InsertEmployee(t, s.DB, id, "Lead "+id, id+"@mea.id", div, div+" Lead", true)
	testutil.InsertRoleMapping(t, s.DB, div, div+" Lead", div, "lead")
}

func assertNotif(t *testing.T, s *Service, recipient string, ev notification.EventType, want int) {
	t.Helper()
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id=? AND event_type=?`,
		recipient, string(ev)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Errorf("%s notifications for %s = %d, want %d", ev, recipient, n, want)
	}
}

func assertAudit(t *testing.T, s *Service, briefID, action string) {
	t.Helper()
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "brief", EntityID: briefID})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Action == action {
			return
		}
	}
	t.Errorf("expected an audit row %q on %s", action, briefID)
}
