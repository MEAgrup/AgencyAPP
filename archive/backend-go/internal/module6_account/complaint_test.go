package module6_account

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var cplID = regexp.MustCompile(`^CPL-\d{6}-\d{4}$`)

// insertActiveEmp seeds an active employee + role mapping so the notification
// resolvers (leadsOfDivision / explicitOrLeads) can find recipients. The HRIS
// divisi is reused as the CDPS division for terseness.
func insertActiveEmp(t *testing.T, s *Service, empID, division, jabatan, level string) {
	t.Helper()
	testutil.InsertEmployee(t, s.DB, empID, "Emp "+empID, empID+"@mea.id", division, jabatan, true)
	testutil.InsertRoleMapping(t, s.DB, division, jabatan, division, level)
}

// complaintFixture: released client + owner AM (EMP-SINTA).
func complaintFixture(t *testing.T, s *Service) (clientID, amID string) {
	clientID, amID = "CLI-CPL", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)
	return
}

func goodComplaint() ComplaintInput {
	return ComplaintInput{Description: "GMV tidak bertumbuh", Severity: "Medium"}
}

func TestLogComplaint_Success(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := complaintFixture(t, s)

	c, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, goodComplaint())
	if err != nil {
		t.Fatalf("LogComplaint: %v", err)
	}
	if !cplID.MatchString(c.ID) {
		t.Errorf("id = %q, want CPL- format", c.ID)
	}
	if c.Status != ComplaintStatusOpen || c.Source != ComplaintSourceWhatsApp || c.AssignedTo != amID {
		t.Errorf("complaint = %+v, want [Open]/WhatsApp/assigned to AM", c)
	}
	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "complaint", EntityID: c.ID})
	if len(entries) != 1 || entries[0].Action != "create" {
		t.Fatalf("audit = %+v, want one create", entries)
	}
}

func TestLogComplaint_Validation(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := complaintFixture(t, s)

	bad := goodComplaint()
	bad.Description = "  "
	if _, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, bad); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("no description: want ErrIncomplete, got %v", err)
	}
	bad = goodComplaint()
	bad.Severity = "Critical"
	if _, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, bad); !errors.Is(err, ErrInvalidSeverity) {
		t.Fatalf("bad severity: want ErrInvalidSeverity, got %v", err)
	}
	var n int
	s.DB.QueryRow(`SELECT COUNT(*) FROM complaints`).Scan(&n)
	if n != 0 {
		t.Fatalf("failed validation must mint no complaint, got %d", n)
	}
}

func TestLogComplaint_PermissionMatrix(t *testing.T) {
	s := newStrategySvc(t)
	complaintFixture(t, s) // CLI-CPL owned by EMP-SINTA

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"owner AM", accountStaff("EMP-SINTA"), true},
		{"director", directorActor("EMP-DIR"), true},
		{"other AM", accountStaff("EMP-OTHER"), false},
		{"account lead", accountLead("EMP-ALEAD"), false},
		{"creative staff", divisionStaff("Creative", "EMP-C"), false},
		{"sales lead", salesLead("EMP-SL"), false},
		{"OD", odActor("EMP-OD"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := s.LogComplaint(context.Background(), c.actor, "CLI-CPL", goodComplaint())
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrLogComplaintForbidden) {
				t.Fatalf("expected ErrLogComplaintForbidden, got %v", err)
			}
		})
	}
}

func TestLogComplaint_PreReleaseAndMissing(t *testing.T) {
	s := newStrategySvc(t)
	insertClient(t, s, "CLI-PRE", false)
	setAM(t, s, "CLI-PRE", "EMP-SINTA")
	if _, err := s.LogComplaint(context.Background(), accountStaff("EMP-SINTA"), "CLI-PRE", goodComplaint()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pre-release: want ErrNotFound, got %v", err)
	}
	if _, err := s.LogComplaint(context.Background(), directorActor("EMP-DIR"), "CLI-GHOST", goodComplaint()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: want ErrNotFound, got %v", err)
	}
}

// TestLogComplaint_RelatedRef: the optional Related Service/Brief must belong to
// the SAME client (§8 Rule 3); a foreign or bogus ref is rejected.
func TestLogComplaint_RelatedRef(t *testing.T) {
	s := newStrategySvc(t)
	// directFixture builds CLI-D/SVC-D/EMP-SINTA; create a Creative brief on it.
	_, svcID, amID := directFixture(t, s)
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief())
	if err != nil {
		t.Fatal(err)
	}
	// A second client with its own service.
	insertClient(t, s, "CLI-OTHER", true)
	setAM(t, s, "CLI-OTHER", "EMP-RANI")
	insertService(t, s, "SVC-OTHER", "CLI-OTHER", false, serviceStatusAwaitingOnboarding)

	// Service of this client — ok.
	in := goodComplaint()
	in.RelatedRef = svcID
	if _, err := s.LogComplaint(context.Background(), accountStaff(amID), "CLI-D", in); err != nil {
		t.Fatalf("service ref: %v", err)
	}
	// Brief of this client — ok.
	in.RelatedRef = b.ID
	if _, err := s.LogComplaint(context.Background(), accountStaff(amID), "CLI-D", in); err != nil {
		t.Fatalf("brief ref: %v", err)
	}
	// Service belonging to ANOTHER client — rejected.
	in.RelatedRef = "SVC-OTHER"
	if _, err := s.LogComplaint(context.Background(), accountStaff(amID), "CLI-D", in); !errors.Is(err, ErrInvalidRelatedRef) {
		t.Fatalf("foreign ref: want ErrInvalidRelatedRef, got %v", err)
	}
	// Bogus ref — rejected.
	in.RelatedRef = "SVC-000000-0000"
	if _, err := s.LogComplaint(context.Background(), accountStaff(amID), "CLI-D", in); !errors.Is(err, ErrInvalidRelatedRef) {
		t.Fatalf("bogus ref: want ErrInvalidRelatedRef, got %v", err)
	}
}

// TestComplaintLifecycle: [Open] -> [In Progress] -> [Resolved] -> [Closed], with
// resolution notes mandatory before [Resolved] and out-of-order moves blocked.
func TestComplaintLifecycle(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := complaintFixture(t, s)
	c, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, goodComplaint())
	if err != nil {
		t.Fatal(err)
	}

	// Cannot close straight from [Open].
	var be *statemachine.BlockedError
	if _, err := s.CloseComplaint(context.Background(), accountStaff(amID), c.ID); !errors.As(err, &be) {
		t.Fatalf("close from open: want BlockedError, got %v", err)
	}
	// Open -> In Progress.
	if _, err := s.StartComplaint(context.Background(), accountStaff(amID), c.ID); err != nil {
		t.Fatalf("StartComplaint: %v", err)
	}
	// Resolve needs notes.
	if _, err := s.ResolveComplaint(context.Background(), accountStaff(amID), c.ID, "  "); !errors.Is(err, ErrResolutionNotesRequired) {
		t.Fatalf("resolve without notes: want ErrResolutionNotesRequired, got %v", err)
	}
	if _, err := s.ResolveComplaint(context.Background(), accountStaff(amID), c.ID, "footage diperbaiki"); err != nil {
		t.Fatalf("ResolveComplaint: %v", err)
	}
	// Close after resolve (AM confirms satisfaction).
	if _, err := s.CloseComplaint(context.Background(), accountStaff(amID), c.ID); err != nil {
		t.Fatalf("CloseComplaint: %v", err)
	}
	got, err := s.GetComplaint(context.Background(), accountStaff(amID), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != ComplaintStatusClosed || got.ResolutionNotes != "footage diperbaiki" {
		t.Errorf("complaint = %+v, want [Closed] + notes", got)
	}
}

// TestComplaint_ManagePermission: owner AM, Account lead/SPV (escalation) and
// Director may drive status; other AMs, divisions and OD may not.
func TestComplaint_ManagePermission(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := complaintFixture(t, s)

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"owner AM", accountStaff(amID), true},
		{"account lead", accountLead("EMP-ALEAD"), true},
		{"director", directorActor("EMP-DIR"), true},
		{"other AM", accountStaff("EMP-OTHER"), false},
		{"creative staff", divisionStaff("Creative", "EMP-C"), false},
		{"OD", odActor("EMP-OD"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cp, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, goodComplaint())
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.StartComplaint(context.Background(), c.actor, cp.ID)
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrComplaintManageForbidden) {
				t.Fatalf("expected ErrComplaintManageForbidden, got %v", err)
			}
		})
	}
}

// TestGetComplaint_Visibility: OD/Director/Account lead/owning AM read any of the
// client's complaints; a Brief-tied complaint is also visible to that Brief's
// division (§8 Rule 4); a client-level complaint is not.
func TestGetComplaint_Visibility(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief()) // Creative
	if err != nil {
		t.Fatal(err)
	}
	tied, err := s.LogComplaint(context.Background(), accountStaff(amID), "CLI-D", ComplaintInput{
		Description: "2 video buruk", Severity: "Medium", RelatedRef: b.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	clientLevel, err := s.LogComplaint(context.Background(), accountStaff(amID), "CLI-D", goodComplaint())
	if err != nil {
		t.Fatal(err)
	}

	base := []permission.Actor{
		accountStaff(amID), accountLead("EMP-ALEAD"), odActor("EMP-OD"), directorActor("EMP-DIR"),
	}
	for _, a := range base {
		if _, err := s.GetComplaint(context.Background(), a, tied.ID); err != nil {
			t.Errorf("%+v should read tied complaint: %v", a.Role, err)
		}
	}
	// Brief-tied: the Brief's division (Creative) staff/lead read it (context).
	for _, a := range []permission.Actor{divisionStaff("Creative", "EMP-C"), divisionLead("Creative", "EMP-CL")} {
		if _, err := s.GetComplaint(context.Background(), a, tied.ID); err != nil {
			t.Errorf("%+v should read Brief-tied complaint: %v", a.Role, err)
		}
	}
	// A client-level complaint is NOT visible to Creative, and another AM / other
	// division never see either.
	if _, err := s.GetComplaint(context.Background(), divisionStaff("Creative", "EMP-C"), clientLevel.ID); !errors.Is(err, ErrComplaintForbidden) {
		t.Errorf("creative on client-level complaint: want forbidden, got %v", err)
	}
	for _, a := range []permission.Actor{accountStaff("EMP-OTHER"), divisionStaff("Ads", "EMP-AD")} {
		if _, err := s.GetComplaint(context.Background(), a, tied.ID); !errors.Is(err, ErrComplaintForbidden) {
			t.Errorf("%+v must be denied, got %v", a.Role, err)
		}
	}
	// Missing complaint.
	if _, err := s.GetComplaint(context.Background(), directorActor("EMP-DIR"), "CPL-000000-0000"); !errors.Is(err, ErrComplaintNotFound) {
		t.Errorf("missing: want ErrComplaintNotFound, got %v", err)
	}
}

func TestListClientComplaints(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := complaintFixture(t, s)
	for i := 0; i < 2; i++ {
		if _, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, goodComplaint()); err != nil {
			t.Fatal(err)
		}
	}
	for _, a := range []permission.Actor{accountStaff(amID), accountLead("EMP-ALEAD"), odActor("EMP-OD"), directorActor("EMP-DIR")} {
		list, err := s.ListClientComplaints(context.Background(), a, clientID)
		if err != nil || len(list) != 2 {
			t.Errorf("%+v client complaints = %v (err %v), want 2", a.Role, list, err)
		}
	}
	// Another AM cannot list this client's complaints.
	if _, err := s.ListClientComplaints(context.Background(), accountStaff("EMP-OTHER"), clientID); !errors.Is(err, ErrComplaintForbidden) {
		t.Errorf("other AM: want ErrComplaintForbidden, got %v", err)
	}
	// Missing client.
	if _, err := s.ListClientComplaints(context.Background(), directorActor("EMP-DIR"), "CLI-GHOST"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing client: want ErrNotFound, got %v", err)
	}
}

// TestLogComplaint_Notification: EvComplaintLogged (FROZEN catalog) fires to the
// Account SPV/lead on logging (the self-logging AM is not self-notified).
func TestLogComplaint_Notification(t *testing.T) {
	s := newStrategySvc(t)
	s.Catalog = notification.NewCatalog()
	insertActiveEmp(t, s, "EMP-ALEAD", "Account", "Head Account", "lead")
	clientID, amID := complaintFixture(t, s)

	c, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, goodComplaint())
	if err != nil {
		t.Fatal(err)
	}
	// The Account lead is notified; the logging AM is not (self excluded).
	for who, want := range map[string]int{"EMP-ALEAD": 1, amID: 0} {
		var n int
		if err := s.DB.QueryRow(
			`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id = ? AND event_type = ? AND entity_id = ?`,
			who, string(notification.EvComplaintLogged), c.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != want {
			t.Errorf("%s notifications = %d, want %d", who, n, want)
		}
	}
}

func TestComplaint_HistoryImmutable(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := complaintFixture(t, s)
	c, err := s.LogComplaint(context.Background(), accountStaff(amID), clientID, goodComplaint())
	if err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := s.DB.QueryRow(`SELECT id FROM audit_log WHERE entity_id = ? AND action = 'create'`, c.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE audit_log SET action='tampered' WHERE id = ?`, id); err == nil {
		t.Fatal("expected UPDATE on audit_log to be blocked")
	}
	if _, err := s.DB.Exec(`DELETE FROM audit_log WHERE id = ?`, id); err == nil {
		t.Fatal("expected DELETE on audit_log to be blocked")
	}
}
