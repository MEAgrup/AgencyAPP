package module6_account

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

var brfID = regexp.MustCompile(`^BRF-\d{6}-\d{4}$`)

// ---- fixtures & helpers ----

func divisionStaff(division, id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: division, Level: permission.LevelStaff}}
}
func divisionLead(division, id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: division, Level: permission.LevelLead}}
}

// directFixture: released client + owner AM + Direct (flag=No) awaiting service.
func directFixture(t *testing.T, s *Service) (clientID, svcID, amID string) {
	clientID, svcID, amID = "CLI-D", "SVC-D", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)
	insertService(t, s, svcID, clientID, false, serviceStatusAwaitingOnboarding)
	return
}

// approvedPlanFixture: released client + owner AM + plan-gated service driven to
// [Strategy Approved] with a real approved STR- row.
func approvedPlanFixture(t *testing.T, s *Service) (clientID, svcID, amID, strID string) {
	clientID, svcID, amID = planGatedFixture(t, s)
	st := createSubmitted(t, s, amID, svcID)
	if err := s.ApproveStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID); err != nil {
		t.Fatalf("approve strategy: %v", err)
	}
	return clientID, svcID, amID, st.ID
}

func goodBrief() BriefInput {
	return BriefInput{
		Title: "12 Product Videos", AssignedDivision: "Creative", DeliverableType: "Product Video",
		QuantityTarget: 12, DueDate: "2026-08-30", Priority: "High",
	}
}

func briefRow(t *testing.T, s *Service, id string) (status, strategyID string) {
	t.Helper()
	if err := s.DB.QueryRow(`SELECT status, COALESCE(strategy_id,'') FROM briefs WHERE id = ?`, id).Scan(&status, &strategyID); err != nil {
		t.Fatal(err)
	}
	return
}

// driveBrief moves a Brief through the brief_task engine (helper for the derived
// revision-count assertion).
func driveBrief(t *testing.T, s *Service, id, to string, actor permission.Actor) {
	t.Helper()
	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := s.engine().Transition(context.Background(), tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs", EntityID: id, To: to, Actor: actor,
	}); err != nil {
		t.Fatalf("drive brief -> %s: %v", to, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// ---- CreateBrief ----

func TestCreateBrief_Direct_Success(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)

	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief())
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	if !brfID.MatchString(b.ID) {
		t.Errorf("id = %q, want BRF- format", b.ID)
	}
	if b.Status != BriefStatusToDo || b.StrategyID != "" {
		t.Errorf("brief = %+v, want [To Do] + no strategy", b)
	}
	// §5 Flow 2: first brief advances the Service to [Briefed].
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusBriefed {
		t.Errorf("service = %q, want [Briefed]", ss)
	}
	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "brief", EntityID: b.ID})
	if len(entries) != 1 || entries[0].Action != "create" {
		t.Fatalf("audit = %+v, want one create", entries)
	}
}

func TestCreateBrief_PlanGated_Success(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID, strID := approvedPlanFixture(t, s)

	in := goodBrief()
	in.StrategyID = strID
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, in)
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	if b.StrategyID != strID {
		t.Errorf("strategy_id = %q, want %q", b.StrategyID, strID)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusBriefed {
		t.Errorf("service = %q, want [Briefed]", ss)
	}
	_, gotStr := briefRow(t, s, b.ID)
	if gotStr != strID {
		t.Errorf("persisted strategy_id = %q, want %q", gotStr, strID)
	}
}

// TestCreateBrief_FirstBriefOnlyTransitions: the first Brief moves the Service to
// [Briefed]; a second Brief finds it already [Briefed] and leaves it there
// (§5 Flow 2 "first Brief"). [In Execution] is reached only via OnBriefLeavesToDo.
func TestCreateBrief_FirstBriefOnlyTransitions(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)

	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief()); err != nil {
		t.Fatal(err)
	}
	second := goodBrief()
	second.AssignedDivision = "Ads"
	second.Title = "TikTok Ads Campaign"
	second.DeliverableType = "Ad Campaign"
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, second); err != nil {
		t.Fatalf("second brief: %v", err)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusBriefed {
		t.Errorf("service = %q, want still [Briefed] after 2 briefs", ss)
	}
}

func TestCreateBrief_PlanGatedAwaitingBlocked(t *testing.T) {
	s := newStrategySvc(t)
	clientID, _, amID := planGatedFixture(t, s) // plan-gated, still Awaiting, no approved STR
	_ = clientID
	in := goodBrief()
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), "SVC-A", in); !errors.Is(err, ErrStrategyRequired) {
		t.Fatalf("plan-gated awaiting: want ErrStrategyRequired, got %v", err)
	}
	// No BRF- minted for the blocked attempt.
	var n int
	s.DB.QueryRow(`SELECT COUNT(*) FROM briefs`).Scan(&n)
	if n != 0 {
		t.Fatalf("no brief should exist after a blocked create, got %d", n)
	}
}

func TestCreateBrief_StrategyIDRules(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID, strID := approvedPlanFixture(t, s)

	// Plan-gated with a missing / wrong Strategy ID => mismatch.
	for _, bad := range []string{"", "STR-999999-9999"} {
		in := goodBrief()
		in.StrategyID = bad
		if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, in); !errors.Is(err, ErrBriefStrategyMismatch) {
			t.Fatalf("strategy_id=%q: want ErrBriefStrategyMismatch, got %v", bad, err)
		}
	}

	// Direct with a supplied Strategy ID => not allowed.
	_, dSvc, dAM := directFixture(t, s)
	in := goodBrief()
	in.StrategyID = strID
	if _, err := s.CreateBrief(context.Background(), accountStaff(dAM), dSvc, in); !errors.Is(err, ErrBriefStrategyNotAllowed) {
		t.Fatalf("direct + strategy_id: want ErrBriefStrategyNotAllowed, got %v", err)
	}
}

func TestCreateBrief_Validation(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)

	mut := func(f func(*BriefInput)) BriefInput { in := goodBrief(); f(&in); return in }
	cases := []struct {
		name string
		in   BriefInput
		want error
	}{
		{"no title", mut(func(b *BriefInput) { b.Title = "  " }), ErrIncomplete},
		{"no deliverable", mut(func(b *BriefInput) { b.DeliverableType = "" }), ErrIncomplete},
		{"zero quantity", mut(func(b *BriefInput) { b.QuantityTarget = 0 }), ErrIncomplete},
		{"no due date", mut(func(b *BriefInput) { b.DueDate = "" }), ErrIncomplete},
		{"bad due date", mut(func(b *BriefInput) { b.DueDate = "31-08-2026" }), ErrIncomplete},
		{"no priority", mut(func(b *BriefInput) { b.Priority = "" }), ErrIncomplete},
		{"bad priority", mut(func(b *BriefInput) { b.Priority = "Urgent" }), ErrInvalidPriority},
		{"no division", mut(func(b *BriefInput) { b.AssignedDivision = "" }), ErrIncomplete},
		{"bad division", mut(func(b *BriefInput) { b.AssignedDivision = "Finance" }), ErrInvalidDivision},
		{"recurring incomplete", mut(func(b *BriefInput) { b.Recurring = true }), ErrIncomplete},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, c.in); !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}
	// No id minted, no partial rows, service untouched.
	var n int
	s.DB.QueryRow(`SELECT COUNT(*) FROM briefs`).Scan(&n)
	if n != 0 {
		t.Fatalf("failed validations must mint no brief, got %d", n)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusAwaitingOnboarding {
		t.Errorf("service must stay [Awaiting Onboarding], got %q", ss)
	}
}

func TestCreateBrief_RecurringSuccess(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	in := goodBrief()
	in.Recurring = true
	in.RecurringFrequency = "Weekly"
	in.RecurringCount = 8
	in.RecurringEndDate = "2026-10-30"
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, in)
	if err != nil {
		t.Fatalf("recurring brief: %v", err)
	}
	got, err := s.GetBrief(context.Background(), accountStaff(amID), b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Recurring || got.RecurringFrequency != "Weekly" || got.RecurringCount != 8 || got.RecurringEndDate != "2026-10-30" {
		t.Errorf("recurring round-trip = %+v", got)
	}
}

func TestCreateBrief_PermissionMatrix(t *testing.T) {
	s := newStrategySvc(t)
	directFixture(t, s) // CLI-D / SVC-D owned by EMP-SINTA

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"owner AM", accountStaff("EMP-SINTA"), true},
		{"director", directorActor("EMP-DIR"), true},
		{"other AM", accountStaff("EMP-OTHER"), false},
		{"account lead", accountLead("EMP-ALEAD"), false},
		{"creative staff", divisionStaff("Creative", "EMP-CRV"), false},
		{"sales lead", salesLead("EMP-SL"), false},
		{"OD", odActor("EMP-OD"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// Fresh Direct service per case (first-brief transition + terseness).
			svc := "SVC-D-" + c.name
			insertService(t, s, svc, "CLI-D", false, serviceStatusAwaitingOnboarding)
			_, err := s.CreateBrief(context.Background(), c.actor, svc, goodBrief())
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrBriefCreateForbidden) {
				t.Fatalf("expected ErrBriefCreateForbidden, got %v", err)
			}
		})
	}
}

func TestCreateBrief_ServiceNotBriefable(t *testing.T) {
	s := newStrategySvc(t)
	insertClient(t, s, "CLI-D", true)
	setAM(t, s, "CLI-D", "EMP-SINTA")
	insertService(t, s, "SVC-VOID", "CLI-D", false, "[Cancelled — Service Voided]")
	if _, err := s.CreateBrief(context.Background(), accountStaff("EMP-SINTA"), "SVC-VOID", goodBrief()); !errors.Is(err, ErrServiceNotBriefable) {
		t.Fatalf("voided service: want ErrServiceNotBriefable, got %v", err)
	}
	// Missing service.
	if _, err := s.CreateBrief(context.Background(), accountStaff("EMP-SINTA"), "SVC-GHOST", goodBrief()); !errors.Is(err, ErrServiceNotFound) {
		t.Fatalf("missing service: want ErrServiceNotFound, got %v", err)
	}
}

// TestCreateBrief_LiveStream: a Live Stream Brief skips the task machine and is
// born with the off-machine marker (§6 Rule 2); the Service still advances.
func TestCreateBrief_LiveStream(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	in := goodBrief()
	in.AssignedDivision = DivisionLiveStream
	in.DeliverableType = "Live Stream Session"
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, in)
	if err != nil {
		t.Fatalf("live stream brief: %v", err)
	}
	if b.Status != BriefStatusVendorDispatched {
		t.Errorf("status = %q, want %q", b.Status, BriefStatusVendorDispatched)
	}
	st, _ := briefRow(t, s, b.ID)
	if st != BriefStatusVendorDispatched {
		t.Errorf("persisted status = %q", st)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusBriefed {
		t.Errorf("service = %q, want [Briefed]", ss)
	}
}

// TestCreateBrief_PlanAddendum: a Brief flagged as beyond the approved outline is
// logged on the Plan (§5 Rule 2 / M6-OA-5), never a silent change.
func TestCreateBrief_PlanAddendum(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID, strID := approvedPlanFixture(t, s)
	in := goodBrief()
	in.StrategyID = strID
	in.IsAddendum = true
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, in); err != nil {
		t.Fatal(err)
	}
	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "strategy_plan", EntityID: strID})
	found := false
	for _, e := range entries {
		if e.Action == "plan_addendum" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a plan_addendum audit row on %s, got %+v", strID, entries)
	}
}

// ---- OnBriefLeavesToDo (§5 Flow 3) ----

func TestOnBriefLeavesToDo(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief()); err != nil {
		t.Fatal(err)
	}
	// Service is [Briefed]; a Brief leaving [To Do] advances it to [In Execution].
	runHook := func() error {
		tx, err := s.DB.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := s.OnBriefLeavesToDo(context.Background(), tx, accountStaff(amID), svcID); err != nil {
			return err
		}
		return tx.Commit()
	}
	if err := runHook(); err != nil {
		t.Fatalf("hook: %v", err)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusInExecution {
		t.Fatalf("service = %q, want [In Execution]", ss)
	}
	// Idempotent: a second call (another Brief leaving To Do) is a no-op.
	if err := runHook(); err != nil {
		t.Fatalf("second hook: %v", err)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusInExecution {
		t.Errorf("service = %q, want still [In Execution]", ss)
	}
}

func TestOnBriefLeavesToDo_NoOpBeforeBriefed(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s) // service still [Awaiting Onboarding]
	_ = amID
	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := s.OnBriefLeavesToDo(context.Background(), tx, accountStaff(amID), svcID); err != nil {
		t.Fatalf("hook on pre-briefed service must no-op, got %v", err)
	}
	tx.Commit()
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusAwaitingOnboarding {
		t.Errorf("service moved unexpectedly to %q", ss)
	}
}

// ---- read visibility (§6/§9.1) ----

func TestGetBrief_VisibilityMatrix(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief()) // Creative
	if err != nil {
		t.Fatal(err)
	}

	allow := []permission.Actor{
		accountStaff(amID),                 // owning AM
		accountLead("EMP-ALEAD"),           // Account lead (division-wide)
		odActor("EMP-OD"),                  // OD read-everywhere
		directorActor("EMP-DIR"),           // Director
		divisionStaff("Creative", "EMP-C"), // target-division staff
		divisionLead("Creative", "EMP-CL"), // target-division lead
	}
	for _, a := range allow {
		if _, err := s.GetBrief(context.Background(), a, b.ID); err != nil {
			t.Errorf("%+v should read brief: %v", a.Role, err)
		}
	}
	deny := []permission.Actor{
		accountStaff("EMP-OTHER"),      // another AM
		divisionStaff("Ads", "EMP-AD"), // other-division staff
	}
	for _, a := range deny {
		if _, err := s.GetBrief(context.Background(), a, b.ID); !errors.Is(err, ErrBriefForbidden) {
			t.Errorf("%+v must be denied, got %v", a.Role, err)
		}
	}
	// Missing brief.
	if _, err := s.GetBrief(context.Background(), directorActor("EMP-DIR"), "BRF-000000-0000"); !errors.Is(err, ErrBriefNotFound) {
		t.Errorf("missing brief: want ErrBriefNotFound, got %v", err)
	}
}

func TestListDivisionQueue(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	// Two Creative briefs + one Ads brief on the same service.
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief()); err != nil {
		t.Fatal(err)
	}
	second := goodBrief()
	second.Title = "More Videos"
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, second); err != nil {
		t.Fatal(err)
	}
	ads := goodBrief()
	ads.AssignedDivision = "Ads"
	ads.DeliverableType = "Ad Campaign"
	ads.Title = "Ads"
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, ads); err != nil {
		t.Fatal(err)
	}

	// Creative staff/lead + Account lead (keputusan Nerissa 2026-07-12: pantau
	// dispatch lintas divisi) + OD + Director see the 2 Creative briefs.
	for _, a := range []permission.Actor{divisionStaff("Creative", "EMP-C"), divisionLead("Creative", "EMP-CL"), accountLead("EMP-ALEAD"), odActor("EMP-OD"), directorActor("EMP-DIR")} {
		q, err := s.ListDivisionQueue(context.Background(), a, "Creative")
		if err != nil {
			t.Fatalf("%+v queue err: %v", a.Role, err)
		}
		if len(q) != 2 {
			t.Errorf("%+v Creative queue = %d, want 2", a.Role, len(q))
		}
	}
	// Ads staff see only the 1 Ads brief.
	if q, err := s.ListDivisionQueue(context.Background(), divisionStaff("Ads", "EMP-AD"), "Ads"); err != nil || len(q) != 1 {
		t.Fatalf("ads queue = %v (err %v), want 1", q, err)
	}
	// Ads staff cannot read the Creative queue; AM & sales lead cannot either.
	for _, a := range []permission.Actor{divisionStaff("Ads", "EMP-AD"), accountStaff(amID), salesLead("EMP-SL")} {
		if _, err := s.ListDivisionQueue(context.Background(), a, "Creative"); !errors.Is(err, ErrQueueForbidden) {
			t.Errorf("%+v must be denied Creative queue, got %v", a.Role, err)
		}
	}
	// Invalid division.
	if _, err := s.ListDivisionQueue(context.Background(), directorActor("EMP-DIR"), "Finance"); !errors.Is(err, ErrInvalidDivision) {
		t.Errorf("invalid division: want ErrInvalidDivision, got %v", err)
	}
}

func TestListServiceBriefs(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief()); err != nil {
		t.Fatal(err)
	}
	ads := goodBrief()
	ads.AssignedDivision = "Ads"
	ads.DeliverableType = "Ad Campaign"
	ads.Title = "Ads"
	if _, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, ads); err != nil {
		t.Fatal(err)
	}

	// Owner AM, Account lead, OD, Director see both (fan-out across divisions).
	for _, a := range []permission.Actor{accountStaff(amID), accountLead("EMP-ALEAD"), odActor("EMP-OD"), directorActor("EMP-DIR")} {
		list, err := s.ListServiceBriefs(context.Background(), a, svcID)
		if err != nil || len(list) != 2 {
			t.Errorf("%+v service briefs = %v (err %v), want 2", a.Role, list, err)
		}
	}
	// Another AM cannot.
	if _, err := s.ListServiceBriefs(context.Background(), accountStaff("EMP-OTHER"), svcID); !errors.Is(err, ErrBriefForbidden) {
		t.Errorf("other AM: want ErrBriefForbidden, got %v", err)
	}
	// Missing service.
	if _, err := s.ListServiceBriefs(context.Background(), directorActor("EMP-DIR"), "SVC-GHOST"); !errors.Is(err, ErrServiceNotFound) {
		t.Errorf("missing service: want ErrServiceNotFound, got %v", err)
	}
}

// TestBrief_RevisionCountDerived drives the brief_task machine and asserts the
// revision count is recomputed from the immutable audit log (§6 Rule 4).
func TestBrief_RevisionCountDerived(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief())
	if err != nil {
		t.Fatal(err)
	}
	staff := divisionStaff("Creative", "EMP-C")
	lead := accountLead("EMP-ALEAD") // AM proxy review; lead authority not needed for these edges
	driveBrief(t, s, b.ID, "[In Progress]", staff)
	driveBrief(t, s, b.ID, "[Submitted]", staff)
	driveBrief(t, s, b.ID, "[In Review]", lead)
	driveBrief(t, s, b.ID, "[Revision Requested]", lead)
	got, err := s.GetBrief(context.Background(), lead, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RevisionCount != 1 {
		t.Errorf("revision count = %d, want 1", got.RevisionCount)
	}
}

func TestBrief_HistoryImmutable(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := directFixture(t, s)
	b, err := s.CreateBrief(context.Background(), accountStaff(amID), svcID, goodBrief())
	if err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := s.DB.QueryRow(`SELECT id FROM audit_log WHERE entity_id = ? AND action = 'create'`, b.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE audit_log SET action='tampered' WHERE id = ?`, id); err == nil {
		t.Fatal("expected UPDATE on audit_log to be blocked")
	}
	if _, err := s.DB.Exec(`DELETE FROM audit_log WHERE id = ?`, id); err == nil {
		t.Fatal("expected DELETE on audit_log to be blocked")
	}
}
