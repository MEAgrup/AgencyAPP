package module6_account

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func newService(t *testing.T) *Service {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d}
}

// ---- actor helpers ----

func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func salesLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Sales", Level: permission.LevelLead}}
}
func odActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}
func directorActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}

// insertClient births a client with a controllable release state.
func insertClient(t *testing.T, s *Service, id string, released bool) {
	t.Helper()
	rel := "NULL"
	if released {
		rel = "NOW()"
	}
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
		         'EMP-BUDI', 'EMP-BUDI', `+rel+`, 'TEST')`, id, id); err != nil {
		t.Fatal(err)
	}
}

// registerAM seeds an active Account-division AM (employee + role mapping) so
// validateAMCandidate accepts it.
func registerAM(t *testing.T, s *Service, id string) {
	t.Helper()
	testutil.InsertEmployee(t, s.DB, id, "AM "+id, id+"@mea.id", "Account", "Account Manager", true)
	testutil.InsertRoleMapping(t, s.DB, "Account", "Account Manager", "Account", "staff")
}

func assignedAM(t *testing.T, s *Service, clientID string) string {
	t.Helper()
	var am string
	if err := s.DB.QueryRow(`SELECT COALESCE(assigned_am_id,'') FROM clients WHERE id = ?`, clientID).Scan(&am); err != nil {
		t.Fatal(err)
	}
	return am
}

// TestAssignAM_Success covers the happy path (§3 Rules 2–4): a released,
// unassigned client is assigned by SPV/Head Account; the pointer is written and
// an immutable audit row is appended.
func TestAssignAM_Success(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-C", true)
	registerAM(t, s, "EMP-SINTA")

	res, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-SINTA")
	if err != nil {
		t.Fatalf("AssignAM: %v", err)
	}
	if res.AssignedAM != "EMP-SINTA" || res.AssignedBy != "EMP-ALEAD" {
		t.Errorf("result = %+v", res)
	}
	if got := assignedAM(t, s, "CLI-C"); got != "EMP-SINTA" {
		t.Errorf("assigned_am_id = %q, want EMP-SINTA", got)
	}
	// Audit row logs who → whom (§3 Rule 3).
	entries, err := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "client", EntityID: "CLI-C"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Action != "am_assigned" {
		t.Fatalf("audit = %+v, want one am_assigned entry", entries)
	}
}

// TestAssignAM_PermissionMatrix asserts §3 Rule 2 authority: only SPV/Head
// Account and Director may assign. AMs, OD, and other divisions are denied.
func TestAssignAM_PermissionMatrix(t *testing.T) {
	s := newService(t)
	registerAM(t, s, "EMP-SINTA")

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"account lead", accountLead("EMP-ALEAD"), true},
		{"director", directorActor("EMP-DIR"), true},
		{"account staff (AM)", accountStaff("EMP-SINTA"), false},
		{"OD read-only", odActor("EMP-OD"), false},
		{"sales lead", salesLead("EMP-SL"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			insertClient(t, s, "CLI-"+c.name, true)
			_, err := s.AssignAM(context.Background(), c.actor, "CLI-"+c.name, "EMP-SINTA")
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrAssignForbidden) {
				t.Fatalf("expected ErrAssignForbidden, got %v", err)
			}
		})
	}
}

// TestAssignAM_PreReleaseInvisible: a client not yet released by Finance is not
// in Account's world — assignment is rejected as not-found (M5 §5 Rule 2).
func TestAssignAM_PreReleaseInvisible(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-PRE", false)
	registerAM(t, s, "EMP-SINTA")
	_, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-PRE", "EMP-SINTA")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for pre-release client, got %v", err)
	}
	if _, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-GHOST", "EMP-SINTA"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for missing client, got %v", err)
	}
}

// TestAssignAM_AlreadyAssigned: exactly one AM at a time (M6-OA-6) — a second
// assign must be rejected and routed to reassignment.
func TestAssignAM_AlreadyAssigned(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-C", true)
	registerAM(t, s, "EMP-SINTA")
	registerAM(t, s, "EMP-RANI")
	if _, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-SINTA"); err != nil {
		t.Fatal(err)
	}
	_, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-RANI")
	if !errors.Is(err, ErrAlreadyAssigned) {
		t.Fatalf("want ErrAlreadyAssigned, got %v", err)
	}
}

// TestAssignAM_InvalidCandidate: the assignee must be an active Account staff.
func TestAssignAM_InvalidCandidate(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-C", true)
	// Sales employee — not an Account AM.
	testutil.InsertEmployee(t, s.DB, "EMP-SALES", "Sales Guy", "sg@mea.id", "Sales", "Sales Executive", true)
	testutil.InsertRoleMapping(t, s.DB, "Sales", "Sales Executive", "Sales", "staff")
	// Inactive Account employee.
	testutil.InsertEmployee(t, s.DB, "EMP-INACTIVE", "Ex AM", "ex@mea.id", "Account", "Account Manager", false)
	testutil.InsertRoleMapping(t, s.DB, "Account", "Account Manager", "Account", "staff")

	for _, am := range []string{"EMP-SALES", "EMP-INACTIVE", "EMP-UNKNOWN"} {
		if _, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", am); !errors.Is(err, ErrInvalidAM) {
			t.Fatalf("AM %q: want ErrInvalidAM, got %v", am, err)
		}
	}
}

// TestReassignAM covers §3 Rule 3: reason mandatory, target valid + different,
// pointer moved, and a second immutable audit row appended.
func TestReassignAM(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-C", true)
	registerAM(t, s, "EMP-SINTA")
	registerAM(t, s, "EMP-RANI")
	if _, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-SINTA"); err != nil {
		t.Fatal(err)
	}

	// Reason required.
	if _, err := s.ReassignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-RANI", "  "); !errors.Is(err, ErrReasonRequired) {
		t.Fatalf("want ErrReasonRequired, got %v", err)
	}
	// Same-AM no-op rejected.
	if _, err := s.ReassignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-SINTA", "cuti"); !errors.Is(err, ErrSameAM) {
		t.Fatalf("want ErrSameAM, got %v", err)
	}
	// Happy path.
	res, err := s.ReassignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-RANI", "Sinta cuti panjang")
	if err != nil {
		t.Fatalf("ReassignAM: %v", err)
	}
	if res.PreviousAM != "EMP-SINTA" || res.AssignedAM != "EMP-RANI" || res.Reason != "Sinta cuti panjang" {
		t.Errorf("result = %+v", res)
	}
	if got := assignedAM(t, s, "CLI-C"); got != "EMP-RANI" {
		t.Errorf("assigned_am_id = %q, want EMP-RANI", got)
	}
	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "client", EntityID: "CLI-C"})
	if len(entries) != 2 || entries[0].Action != "am_reassigned" {
		t.Fatalf("audit = %+v, want am_reassigned newest", entries)
	}
}

// TestReassignAM_NotAssigned: reassigning an unassigned client is rejected.
func TestReassignAM_NotAssigned(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-C", true)
	registerAM(t, s, "EMP-RANI")
	_, err := s.ReassignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-RANI", "alasan")
	if !errors.Is(err, ErrNotAssigned) {
		t.Fatalf("want ErrNotAssigned, got %v", err)
	}
}

// TestIntakeQueue_VisibilityAndContents: only released+unassigned clients show
// (§3 Rule 1); assigning removes a client from the queue; AMs/other divisions
// cannot read the queue.
func TestIntakeQueue_VisibilityAndContents(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-PRE", false) // not released -> never in queue
	insertClient(t, s, "CLI-Q1", true)   // released, unassigned -> in queue
	insertClient(t, s, "CLI-Q2", true)   // released, will be assigned -> leaves queue
	registerAM(t, s, "EMP-SINTA")
	if _, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-Q2", "EMP-SINTA"); err != nil {
		t.Fatal(err)
	}

	q, err := s.IntakeQueue(context.Background(), accountLead("EMP-ALEAD"))
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].ClientID != "CLI-Q1" {
		t.Fatalf("queue = %+v, want [CLI-Q1]", q)
	}
	// OD and Director may also read the queue.
	for _, a := range []permission.Actor{odActor("EMP-OD"), directorActor("EMP-DIR")} {
		if _, err := s.IntakeQueue(context.Background(), a); err != nil {
			t.Errorf("%+v should read intake queue: %v", a.Role, err)
		}
	}
	// AMs and other divisions cannot see the unassigned queue (§3 Rule 1).
	for _, a := range []permission.Actor{accountStaff("EMP-SINTA"), salesLead("EMP-SL")} {
		if _, err := s.IntakeQueue(context.Background(), a); !errors.Is(err, ErrIntakeForbidden) {
			t.Errorf("%+v must not read intake queue, got %v", a.Role, err)
		}
	}
}

// TestWorkload counts active clients per AM (§3 Rule 5) and enforces the same
// read gate as the intake queue.
func TestWorkload(t *testing.T) {
	s := newService(t)
	registerAM(t, s, "EMP-SINTA")
	registerAM(t, s, "EMP-RANI")
	for _, id := range []string{"CLI-1", "CLI-2", "CLI-3"} {
		insertClient(t, s, id, true)
	}
	lead := accountLead("EMP-ALEAD")
	if _, err := s.AssignAM(context.Background(), lead, "CLI-1", "EMP-SINTA"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AssignAM(context.Background(), lead, "CLI-2", "EMP-SINTA"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AssignAM(context.Background(), lead, "CLI-3", "EMP-RANI"); err != nil {
		t.Fatal(err)
	}

	wl, err := s.Workload(context.Background(), lead)
	if err != nil {
		t.Fatal(err)
	}
	if len(wl) != 2 || wl[0].AMEmployeeID != "EMP-SINTA" || wl[0].ActiveCount != 2 || wl[1].ActiveCount != 1 {
		t.Fatalf("workload = %+v, want Sinta=2, Rani=1", wl)
	}
	if _, err := s.Workload(context.Background(), accountStaff("EMP-SINTA")); !errors.Is(err, ErrIntakeForbidden) {
		t.Fatalf("AM must not read workload, got %v", err)
	}
}

// TestAssignment_HistoryImmutable: assignment audit rows cannot be mutated —
// the immutable history is the source of truth for who owned the client when.
func TestAssignment_HistoryImmutable(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-C", true)
	registerAM(t, s, "EMP-SINTA")
	if _, err := s.AssignAM(context.Background(), accountLead("EMP-ALEAD"), "CLI-C", "EMP-SINTA"); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := s.DB.QueryRow(`SELECT id FROM audit_log WHERE entity_id = 'CLI-C' AND action = 'am_assigned'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE audit_log SET action = 'tampered' WHERE id = ?`, id); err == nil {
		t.Fatal("expected UPDATE on audit_log to be blocked")
	}
	if _, err := s.DB.Exec(`DELETE FROM audit_log WHERE id = ?`, id); err == nil {
		t.Fatal("expected DELETE on audit_log to be blocked")
	}
}
