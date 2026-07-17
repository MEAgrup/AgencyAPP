package module6_account

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// newStrategySvc builds a Service with a real engine (STR + Service machines).
func newStrategySvc(t *testing.T) *Service {
	s := newService(t)
	s.Engine = statemachine.New()
	return s
}

// insertService births a service row with a controllable plan-gate flag + status.
func insertService(t *testing.T, s *Service, svcID, clientID string, requiresPlan bool, status string) {
	t.Helper()
	rsp := 0
	if requiresPlan {
		rsp = 1
	}
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name,
		   standard_price, commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-X', 1, 'TikTok Shop Full Management', '10000000.00', 'rule', ?, ?, 'TEST')`,
		svcID, clientID, status, rsp); err != nil {
		t.Fatal(err)
	}
}

// setAM points a client's assigned_am_id (bypasses AssignAM to keep tests terse).
func setAM(t *testing.T, s *Service, clientID, amID string) {
	t.Helper()
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE clients SET assigned_am_id = ? WHERE id = ?`, amID, clientID); err != nil {
		t.Fatal(err)
	}
}

func serviceStatus(t *testing.T, s *Service, svcID string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRow(`SELECT status FROM services WHERE id = ?`, svcID).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// planGatedFixture: released client + owner AM + plan-gated awaiting service.
func planGatedFixture(t *testing.T, s *Service) (clientID, svcID, amID string) {
	clientID, svcID, amID = "CLI-A", "SVC-A", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)
	insertService(t, s, svcID, clientID, true, serviceStatusAwaitingOnboarding)
	return
}

func goodInput() StrategyInput {
	return StrategyInput{
		Objective: "grow GMV 30% in 60 days", TargetKPI: "GMV +30%",
		DivisionsInvolved: []string{"Creative", "Ads"}, PlannedBriefOutline: "12 videos, 2 campaigns",
		TimelineStart: "2026-07-01", TimelineEnd: "2026-08-30",
	}
}

// createDrafted seeds a strategy in [Strategy Drafting] owned by amID.
func createDrafted(t *testing.T, s *Service, amID, svcID string) Strategy {
	t.Helper()
	st, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, goodInput())
	if err != nil {
		t.Fatalf("CreateStrategy: %v", err)
	}
	return st
}

// createSubmitted seeds a strategy in [Strategy Submitted for Approval].
func createSubmitted(t *testing.T, s *Service, amID, svcID string) Strategy {
	t.Helper()
	st := createDrafted(t, s, amID, svcID)
	if _, err := s.SubmitStrategy(context.Background(), accountStaff(amID), st.ID); err != nil {
		t.Fatalf("SubmitStrategy: %v", err)
	}
	return st
}

func TestCreateStrategy_Success(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)

	st := createDrafted(t, s, amID, svcID)
	if st.Status != StrategyStatusDrafting || st.ServiceID != svcID {
		t.Fatalf("strategy = %+v", st)
	}
	if len(st.DivisionsInvolved) != 2 || st.DivisionsInvolved[0] != "Creative" || st.DivisionsInvolved[1] != "Ads" {
		t.Errorf("divisions = %v", st.DivisionsInvolved)
	}
	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "strategy_plan", EntityID: st.ID})
	if len(entries) != 1 || entries[0].Action != "create" {
		t.Fatalf("audit = %+v, want one create", entries)
	}
}

func TestCreateStrategy_PermissionMatrix(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)

	// Only the OWNING AM may draft (§4 Rule 1) — plus Director (akses penuh,
	// preseden W1-13). Everyone else — including another AM, the Account lead,
	// Sales, OD — is denied ErrNotOwnerAM.
	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"owner AM", accountStaff(amID), true},
		{"other AM", accountStaff("EMP-OTHER"), false},
		{"account lead", accountLead("EMP-ALEAD"), false},
		{"sales lead", salesLead("EMP-SL"), false},
		{"OD", odActor("EMP-OD"), false},
		{"director", directorActor("EMP-DIR"), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// fresh service per case to keep the 1:1 constraint from interfering
			svc := svcID + "-" + c.name
			insertService(t, s, svc, "CLI-A", true, serviceStatusAwaitingOnboarding)
			_, err := s.CreateStrategy(context.Background(), c.actor, svc, goodInput())
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrNotOwnerAM) {
				t.Fatalf("expected ErrNotOwnerAM, got %v", err)
			}
		})
	}
}

func TestCreateStrategy_Guards(t *testing.T) {
	s := newStrategySvc(t)
	insertClient(t, s, "CLI-A", true)
	setAM(t, s, "CLI-A", "EMP-SINTA")

	// Direct service (flag = No) has no Strategy (§4 Rule 6).
	insertService(t, s, "SVC-DIRECT", "CLI-A", false, serviceStatusAwaitingOnboarding)
	if _, err := s.CreateStrategy(context.Background(), accountStaff("EMP-SINTA"), "SVC-DIRECT", goodInput()); !errors.Is(err, ErrNotPlanGated) {
		t.Fatalf("direct service: want ErrNotPlanGated, got %v", err)
	}

	// Plan-gated but past onboarding.
	insertService(t, s, "SVC-LATE", "CLI-A", true, serviceStatusStrategyApproved)
	if _, err := s.CreateStrategy(context.Background(), accountStaff("EMP-SINTA"), "SVC-LATE", goodInput()); !errors.Is(err, ErrServiceNotAwaiting) {
		t.Fatalf("non-awaiting service: want ErrServiceNotAwaiting, got %v", err)
	}

	// Missing service.
	if _, err := s.CreateStrategy(context.Background(), accountStaff("EMP-SINTA"), "SVC-GHOST", goodInput()); !errors.Is(err, ErrServiceNotFound) {
		t.Fatalf("missing service: want ErrServiceNotFound, got %v", err)
	}
}

func TestCreateStrategy_OneToOne(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	createDrafted(t, s, amID, svcID)
	if _, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, goodInput()); !errors.Is(err, ErrStrategyExists) {
		t.Fatalf("second create: want ErrStrategyExists, got %v", err)
	}
}

func TestCreateStrategy_Validation(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)

	// Missing mandatory field.
	bad := goodInput()
	bad.Objective = "  "
	if _, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, bad); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("missing objective: want ErrIncomplete, got %v", err)
	}
	// Invalid division.
	bad = goodInput()
	bad.DivisionsInvolved = []string{"Creative", "Finance"}
	if _, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, bad); !errors.Is(err, ErrInvalidDivisions) {
		t.Fatalf("bad division: want ErrInvalidDivisions, got %v", err)
	}
	// Reversed timeline.
	bad = goodInput()
	bad.TimelineStart, bad.TimelineEnd = "2026-08-30", "2026-07-01"
	if _, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, bad); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("reversed timeline: want ErrIncomplete, got %v", err)
	}
	// No STR- id should have been minted for any failed attempt.
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM strategy_plans`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("no strategy row should exist after failed validation, got %d", n)
	}
}

func TestUpdateDraft(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createDrafted(t, s, amID, svcID)

	// Non-owner cannot edit.
	if err := s.UpdateDraft(context.Background(), accountStaff("EMP-OTHER"), st.ID, goodInput()); !errors.Is(err, ErrNotOwnerAM) {
		t.Fatalf("non-owner edit: want ErrNotOwnerAM, got %v", err)
	}
	// Owner edits.
	edited := goodInput()
	edited.Objective = "revised objective"
	if err := s.UpdateDraft(context.Background(), accountStaff(amID), st.ID, edited); err != nil {
		t.Fatalf("UpdateDraft: %v", err)
	}
	got, _ := s.GetStrategy(context.Background(), accountStaff(amID), st.ID)
	if got.Objective != "revised objective" {
		t.Errorf("objective = %q", got.Objective)
	}
	// After submit, drafting edits are rejected.
	if _, err := s.SubmitStrategy(context.Background(), accountStaff(amID), st.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateDraft(context.Background(), accountStaff(amID), st.ID, edited); !errors.Is(err, ErrNotDraft) {
		t.Fatalf("edit after submit: want ErrNotDraft, got %v", err)
	}
}

func TestSubmit_OwnerOnly(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createDrafted(t, s, amID, svcID)
	if _, err := s.SubmitStrategy(context.Background(), accountStaff("EMP-OTHER"), st.ID); !errors.Is(err, ErrNotOwnerAM) {
		t.Fatalf("non-owner submit: want ErrNotOwnerAM, got %v", err)
	}
	if _, err := s.SubmitStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID); !errors.Is(err, ErrNotOwnerAM) {
		t.Fatalf("lead submit: want ErrNotOwnerAM, got %v", err)
	}
	if _, err := s.SubmitStrategy(context.Background(), accountStaff(amID), st.ID); err != nil {
		t.Fatalf("owner submit: %v", err)
	}
}

// TestApprove_DoubleTransition is the core §4 Rule 3 assertion: approval flips the
// STR to [Strategy Approved] AND the parent Service to [Strategy Approved] in one
// transaction, and records Approved By.
func TestApprove_DoubleTransition(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createSubmitted(t, s, amID, svcID)

	if err := s.ApproveStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID); err != nil {
		t.Fatalf("ApproveStrategy: %v", err)
	}
	got, _ := s.GetStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID)
	if got.Status != StrategyStatusApproved {
		t.Errorf("STR status = %q, want approved", got.Status)
	}
	if got.ApprovedBy != "EMP-ALEAD" {
		t.Errorf("approved_by = %q", got.ApprovedBy)
	}
	if ss := serviceStatus(t, s, svcID); ss != serviceStatusStrategyApproved {
		t.Errorf("service status = %q, want [Strategy Approved]", ss)
	}
}

func TestApprove_PermissionMatrix(t *testing.T) {
	s := newStrategySvc(t)
	insertClient(t, s, "CLI-A", true)
	setAM(t, s, "CLI-A", "EMP-SINTA")

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"account lead", accountLead("EMP-ALEAD"), true},
		{"director", directorActor("EMP-DIR"), true},
		{"owner AM", accountStaff("EMP-SINTA"), false},
		{"sales lead", salesLead("EMP-SL"), false},
		{"OD", odActor("EMP-OD"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc := "SVC-" + c.name
			insertService(t, s, svc, "CLI-A", true, serviceStatusAwaitingOnboarding)
			st := createSubmitted(t, s, "EMP-SINTA", svc)
			err := s.ApproveStrategy(context.Background(), c.actor, st.ID)
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrApproveForbidden) {
				t.Fatalf("expected ErrApproveForbidden, got %v", err)
			}
		})
	}
}

// TestApprove_WrongState: approving a Plan still in Drafting is blocked by the
// engine (nothing changes).
func TestApprove_WrongState(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createDrafted(t, s, amID, svcID) // still Drafting
	err := s.ApproveStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID)
	var be *statemachine.BlockedError
	if !errors.As(err, &be) {
		t.Fatalf("want BlockedError, got %v", err)
	}
	if serviceStatus(t, s, svcID) != serviceStatusAwaitingOnboarding {
		t.Error("service must not move when STR approval is blocked")
	}
}

func TestRequestRevision(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createSubmitted(t, s, amID, svcID)

	// Notes mandatory.
	if err := s.RequestRevision(context.Background(), accountLead("EMP-ALEAD"), st.ID, "  "); !errors.Is(err, ErrRevisionNotesRequired) {
		t.Fatalf("want ErrRevisionNotesRequired, got %v", err)
	}
	// AM cannot request revision.
	if err := s.RequestRevision(context.Background(), accountStaff(amID), st.ID, "fix KPI"); !errors.Is(err, ErrApproveForbidden) {
		t.Fatalf("AM revision: want ErrApproveForbidden, got %v", err)
	}
	// Lead requests revision -> back to Drafting, notes stored, count derived = 1.
	if err := s.RequestRevision(context.Background(), accountLead("EMP-ALEAD"), st.ID, "target KPI kurang spesifik"); err != nil {
		t.Fatalf("RequestRevision: %v", err)
	}
	got, _ := s.GetStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID)
	if got.Status != StrategyStatusDrafting {
		t.Errorf("status = %q, want Drafting", got.Status)
	}
	if got.RevisionNotes != "target KPI kurang spesifik" {
		t.Errorf("revision notes = %q", got.RevisionNotes)
	}
	if got.RevisionCount != 1 {
		t.Errorf("revision count = %d, want 1", got.RevisionCount)
	}
	// Resubmit + revise again -> count = 2 (derived from audit log).
	if _, err := s.SubmitStrategy(context.Background(), accountStaff(amID), st.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RequestRevision(context.Background(), accountLead("EMP-ALEAD"), st.ID, "sekali lagi"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetStrategy(context.Background(), accountLead("EMP-ALEAD"), st.ID)
	if got.RevisionCount != 2 {
		t.Errorf("revision count = %d, want 2", got.RevisionCount)
	}
}

func TestStrategy_HistoryImmutable(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createDrafted(t, s, amID, svcID)

	var id int64
	if err := s.DB.QueryRow(`SELECT id FROM audit_log WHERE entity_id = ? AND action = 'create'`, st.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE audit_log SET action='tampered' WHERE id = ?`, id); err == nil {
		t.Fatal("expected UPDATE on audit_log to be blocked")
	}
	if _, err := s.DB.Exec(`DELETE FROM audit_log WHERE id = ?`, id); err == nil {
		t.Fatal("expected DELETE on audit_log to be blocked")
	}
	_ = svcID
}

func TestStrategy_Visibility(t *testing.T) {
	s := newStrategySvc(t)
	_, svcID, amID := planGatedFixture(t, s)
	st := createDrafted(t, s, amID, svcID)

	// Owner AM, Account lead, OD, Director may read; a different AM may not.
	for _, a := range []permission.Actor{accountStaff(amID), accountLead("EMP-ALEAD"), odActor("EMP-OD"), directorActor("EMP-DIR")} {
		if _, err := s.GetStrategy(context.Background(), a, st.ID); err != nil {
			t.Errorf("%+v should read strategy: %v", a.Role, err)
		}
	}
	if _, err := s.GetStrategy(context.Background(), accountStaff("EMP-OTHER"), st.ID); !errors.Is(err, ErrStrategyForbidden) {
		t.Fatalf("other AM get: want ErrStrategyForbidden, got %v", err)
	}

	// List: lead sees all; owner AM sees own; a non-owner AM sees none.
	if list, err := s.ListStrategies(context.Background(), accountLead("EMP-ALEAD")); err != nil || len(list) != 1 {
		t.Fatalf("lead list = %v (err %v), want 1", list, err)
	}
	if list, err := s.ListStrategies(context.Background(), accountStaff(amID)); err != nil || len(list) != 1 {
		t.Fatalf("owner AM list = %v (err %v), want 1", list, err)
	}
	if list, err := s.ListStrategies(context.Background(), accountStaff("EMP-OTHER")); err != nil || len(list) != 0 {
		t.Fatalf("other AM list = %v (err %v), want 0", list, err)
	}
	if _, err := s.ListStrategies(context.Background(), salesLead("EMP-SL")); !errors.Is(err, ErrStrategyForbidden) {
		t.Fatalf("sales list: want ErrStrategyForbidden, got %v", err)
	}
}

// TestGuardBriefCreation exercises the §6 Brief-gate helper the Brief cluster
// will call before driving [Awaiting Onboarding] → [Briefed].
func TestGuardBriefCreation(t *testing.T) {
	s := newStrategySvc(t)
	insertClient(t, s, "CLI-A", true)

	// Plan-gated + still Awaiting Onboarding => blocked.
	insertService(t, s, "SVC-GATED", "CLI-A", true, serviceStatusAwaitingOnboarding)
	if err := GuardBriefCreation(context.Background(), s.DB, "SVC-GATED"); !errors.Is(err, ErrStrategyRequired) {
		t.Fatalf("gated awaiting: want ErrStrategyRequired, got %v", err)
	}
	// Plan-gated + Strategy Approved => allowed.
	insertService(t, s, "SVC-OK", "CLI-A", true, serviceStatusStrategyApproved)
	if err := GuardBriefCreation(context.Background(), s.DB, "SVC-OK"); err != nil {
		t.Fatalf("gated approved: want nil, got %v", err)
	}
	// Direct + Awaiting => allowed (Direct path).
	insertService(t, s, "SVC-DIR", "CLI-A", false, serviceStatusAwaitingOnboarding)
	if err := GuardBriefCreation(context.Background(), s.DB, "SVC-DIR"); err != nil {
		t.Fatalf("direct awaiting: want nil, got %v", err)
	}
	// Missing => not found.
	if err := GuardBriefCreation(context.Background(), s.DB, "SVC-GHOST"); !errors.Is(err, ErrServiceNotFound) {
		t.Fatalf("missing: want ErrServiceNotFound, got %v", err)
	}
}
