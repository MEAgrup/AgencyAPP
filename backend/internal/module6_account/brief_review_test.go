package module6_account

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// submittedBrief creates a Direct Creative brief (on a client/service uniquely
// keyed by suffix) and drives it (division side, deferred to M7–M9/M12) to
// [Submitted], ready for AM review. amID is always EMP-SINTA.
func submittedBrief(t *testing.T, s *Service, suffix string) (briefID, amID string) {
	t.Helper()
	clientID, svcID, am := "CLI-R"+suffix, "SVC-R"+suffix, "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, am)
	insertService(t, s, svcID, clientID, false, serviceStatusAwaitingOnboarding)
	b, err := s.CreateBrief(context.Background(), accountStaff(am), svcID, goodBrief())
	if err != nil {
		t.Fatal(err)
	}
	staff := divisionStaff("Creative", "EMP-C")
	driveBrief(t, s, b.ID, "[In Progress]", staff)
	driveBrief(t, s, b.ID, "[Submitted]", staff)
	return b.ID, am
}

// TestReviewBrief_HappyPath: AM pulls a submitted Brief into review then approves.
func TestReviewBrief_HappyPath(t *testing.T) {
	s := newStrategySvc(t)
	briefID, amID := submittedBrief(t, s, "")

	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), briefID); err != nil {
		t.Fatalf("ReviewBrief: %v", err)
	}
	if st, _ := briefRow(t, s, briefID); st != BriefStatusInReview {
		t.Fatalf("status = %q, want [In Review]", st)
	}
	if _, err := s.ApproveBrief(context.Background(), accountStaff(amID), briefID); err != nil {
		t.Fatalf("ApproveBrief: %v", err)
	}
	if st, _ := briefRow(t, s, briefID); st != BriefStatusApproved {
		t.Fatalf("status = %q, want [Approved]", st)
	}
}

// TestReviewBrief_PermissionMatrix: only the owning AM (or Director) reviews a
// Brief (§6 Rule 3 / §9.1). Account lead approves Strategies, not Briefs.
func TestReviewBrief_PermissionMatrix(t *testing.T) {
	s := newStrategySvc(t)

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
			briefID, _ := submittedBrief(t, s, c.name)
			_, err := s.ReviewBrief(context.Background(), c.actor, briefID)
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrBriefReviewForbidden) {
				t.Fatalf("expected ErrBriefReviewForbidden, got %v", err)
			}
		})
	}
}

// TestReviewBrief_WrongStateAndMissing: reviewing a [To Do] Brief is blocked by
// the engine; a Live Stream Brief ([Dispatched to Vendor]) has no review edge;
// a missing Brief is not-found.
func TestReviewBrief_WrongStateAndMissing(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)

	// [To Do] brief — no [To Do] -> [In Review] edge.
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief())
	if err != nil {
		t.Fatal(err)
	}
	var be *statemachine.BlockedError
	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), b.ID); !errors.As(err, &be) {
		t.Fatalf("todo review: want BlockedError, got %v", err)
	}

	// Live Stream brief is off-machine — review is blocked.
	ls := goodBrief()
	ls.AssignedDivision = DivisionLiveStream
	ls.DeliverableType = "Live Stream Session"
	lsb, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, ls)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), lsb.ID); !errors.As(err, &be) {
		t.Fatalf("LS review: want BlockedError, got %v", err)
	}

	// Missing brief.
	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), "BRF-000000-0000"); !errors.Is(err, ErrBriefNotFound) {
		t.Fatalf("missing review: want ErrBriefNotFound, got %v", err)
	}
}

// TestRequestBriefRevision: mandatory feedback (§7 Rule 2), routes back to the
// same division, counter derived from the audit log (§6 Rule 4), feedback logged.
func TestRequestBriefRevision(t *testing.T) {
	s := newStrategySvc(t)
	briefID, amID := submittedBrief(t, s, "")
	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), briefID); err != nil {
		t.Fatal(err)
	}

	// Feedback mandatory.
	if _, err := s.RequestBriefRevision(context.Background(), accountStaff(amID), briefID, "  "); !errors.Is(err, ErrRevisionNotesRequired) {
		t.Fatalf("empty feedback: want ErrRevisionNotesRequired, got %v", err)
	}
	// With feedback -> back to [Revision Requested], count derived = 1.
	if _, err := s.RequestBriefRevision(context.Background(), accountStaff(amID), briefID, "2 video terlalu terburu-buru"); err != nil {
		t.Fatalf("RequestBriefRevision: %v", err)
	}
	if st, _ := briefRow(t, s, briefID); st != BriefStatusRevisionReq {
		t.Fatalf("status = %q, want [Revision Requested]", st)
	}
	got, err := s.GetBrief(context.Background(), accountStaff(amID), briefID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RevisionCount != 1 || got.RevisionFlagged {
		t.Errorf("count/flag = %d/%v, want 1/false", got.RevisionCount, got.RevisionFlagged)
	}
	// Mandatory feedback recorded immutably in the audit log.
	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "brief", EntityID: briefID})
	found := false
	for _, e := range entries {
		if e.Action == "revision_feedback" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a revision_feedback audit row, got %+v", entries)
	}
}

// runRevisionCycle: review a [Submitted] Brief, request a revision, then drive
// the division-side rework (deferred) back to [Submitted].
func runRevisionCycle(t *testing.T, s *Service, briefID, amID string) {
	t.Helper()
	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), briefID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RequestBriefRevision(context.Background(), accountStaff(amID), briefID, "perbaiki"); err != nil {
		t.Fatal(err)
	}
	staff := divisionStaff("Creative", "EMP-C")
	driveBrief(t, s, briefID, "[In Progress]", staff)
	driveBrief(t, s, briefID, "[Submitted]", staff)
}

// TestRequestBriefRevision_ThreeFlags: crossing 3 revisions surfaces the SPV
// flag (§7 Rule 4 / M6-OA-3) — derived RevisionFlagged true AND the cataloged
// EvRevisionCountFlag fires once, to the producing division's lead.
func TestRequestBriefRevision_ThreeFlags(t *testing.T) {
	s := newStrategySvc(t)
	s.Catalog = notification.NewCatalog()
	// A Creative lead so leadsOfDivision(Creative) resolves a recipient.
	insertActiveEmp(t, s, "EMP-CLEAD", "Creative", "Creative Lead", "lead")

	briefID, amID := submittedBrief(t, s, "")
	runRevisionCycle(t, s, briefID, amID) // count 1
	runRevisionCycle(t, s, briefID, amID) // count 2
	// 3rd revision fires the flag.
	if _, err := s.ReviewBrief(context.Background(), accountStaff(amID), briefID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RequestBriefRevision(context.Background(), accountStaff(amID), briefID, "sekali lagi"); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetBrief(context.Background(), accountStaff(amID), briefID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RevisionCount != 3 || !got.RevisionFlagged {
		t.Fatalf("count/flag = %d/%v, want 3/true", got.RevisionCount, got.RevisionFlagged)
	}
	// Exactly one EvRevisionCountFlag notification to the Creative lead.
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id = ? AND event_type = ?`,
		"EMP-CLEAD", string(notification.EvRevisionCountFlag)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("EvRevisionCountFlag notifications = %d, want 1 (fires only on the crossing)", n)
	}
}
