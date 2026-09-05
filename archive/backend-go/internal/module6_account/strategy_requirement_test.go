package module6_account

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// setOverrideRaw stamps the per-engagement override column directly (bypasses
// SetStrategyRequirement) so the effective-flag matrix can exercise every
// NULL/0/1 combination without going through the permission/window gates.
func setOverrideRaw(t *testing.T, s *Service, svcID string, override *int) {
	t.Helper()
	var err error
	if override == nil {
		_, err = s.DB.ExecContext(context.Background(),
			`UPDATE services SET requires_strategy_plan_override = NULL WHERE id = ?`, svcID)
	} else {
		_, err = s.DB.ExecContext(context.Background(),
			`UPDATE services SET requires_strategy_plan_override = ? WHERE id = ?`, *override, svcID)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func intp(v int) *int { return &v }

// TestEffectiveFlag_Matrix covers COALESCE(override, pin) across NULL/0/1 × pin
// 0/1 through the two consumers: CreateStrategy (plan-gated gate) and
// GuardBriefCreation (brief gate). Effective governs both.
func TestEffectiveFlag_Matrix(t *testing.T) {
	cases := []struct {
		name          string
		pin           bool
		override      *int
		effectivePlan bool
	}{
		{"pin0 no-override", false, nil, false},
		{"pin1 no-override", true, nil, true},
		{"pin0 override1", false, intp(1), true},
		{"pin1 override0", true, intp(0), false},
		{"pin0 override0", false, intp(0), false},
		{"pin1 override1", true, intp(1), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newStrategySvc(t)
			clientID, svcID, amID := "CLI-A", "SVC-A", "EMP-SINTA"
			insertClient(t, s, clientID, true)
			setAM(t, s, clientID, amID)
			insertService(t, s, svcID, clientID, c.pin, serviceStatusAwaitingOnboarding)
			setOverrideRaw(t, s, svcID, c.override)

			// CreateStrategy: allowed iff effective plan-gated, else ErrNotPlanGated.
			_, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, goodInput())
			if c.effectivePlan && err != nil {
				t.Fatalf("effective plan-gated: CreateStrategy err = %v", err)
			}
			if !c.effectivePlan && !errors.Is(err, ErrNotPlanGated) {
				t.Fatalf("effective direct: want ErrNotPlanGated, got %v", err)
			}

			// GuardBriefCreation at [Awaiting Onboarding]: plan-gated is blocked,
			// direct passes.
			g := GuardBriefCreation(context.Background(), s.DB, svcID)
			if c.effectivePlan && !errors.Is(g, ErrStrategyRequired) {
				t.Fatalf("effective plan-gated: guard want ErrStrategyRequired, got %v", g)
			}
			if !c.effectivePlan && g != nil {
				t.Fatalf("effective direct: guard want nil, got %v", g)
			}
		})
	}
}

// TestSetStrategyRequirement_Success: a Direct Service (pin=0) overridden to
// require a plan flips the effective gate, opens Strategy creation, and writes a
// single audited before→after+reason edit.
func TestSetStrategyRequirement_Success(t *testing.T) {
	s := newStrategySvc(t)
	clientID, svcID, amID := "CLI-A", "SVC-A", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)
	insertService(t, s, svcID, clientID, false, serviceStatusAwaitingOnboarding)

	res, err := s.SetStrategyRequirement(context.Background(), accountStaff(amID), svcID, true, "klien minta rencana penuh")
	if err != nil {
		t.Fatalf("SetStrategyRequirement: %v", err)
	}
	if !res.RequiresStrategyPlan || res.PinnedRequirement || !res.Overridden {
		t.Fatalf("result = %+v", res)
	}

	// Guard now blocks direct brief creation; Strategy creation is now allowed.
	if g := GuardBriefCreation(context.Background(), s.DB, svcID); !errors.Is(g, ErrStrategyRequired) {
		t.Fatalf("after override: guard want ErrStrategyRequired, got %v", g)
	}
	if _, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, goodInput()); err != nil {
		t.Fatalf("after override CreateStrategy: %v", err)
	}

	entries, _ := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "service", EntityID: svcID})
	found := 0
	for _, e := range entries {
		if e.Action == "strategy_requirement_override" {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("want one override audit row, got %d (%+v)", found, entries)
	}
}

// TestSetStrategyRequirement_ExemptPlanGated: a plan-gated Service (pin=1)
// overridden to No becomes Direct — Strategy creation is rejected, brief guard
// passes.
func TestSetStrategyRequirement_ExemptPlanGated(t *testing.T) {
	s := newStrategySvc(t)
	clientID, svcID, amID := "CLI-A", "SVC-A", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)
	insertService(t, s, svcID, clientID, true, serviceStatusAwaitingOnboarding)

	if _, err := s.SetStrategyRequirement(context.Background(), accountLead("EMP-ALEAD"), svcID, false, "add-on kecil, tanpa rencana"); err != nil {
		t.Fatalf("SetStrategyRequirement: %v", err)
	}
	if _, err := s.CreateStrategy(context.Background(), accountStaff(amID), svcID, goodInput()); !errors.Is(err, ErrNotPlanGated) {
		t.Fatalf("want ErrNotPlanGated, got %v", err)
	}
	if g := GuardBriefCreation(context.Background(), s.DB, svcID); g != nil {
		t.Fatalf("after exempt: guard want nil, got %v", g)
	}
}

// TestSetStrategyRequirement_PermissionMatrix: PRD M6-OA-1 = AM/SPV. Owning AM,
// Account lead, and Director may override; another AM, Sales, and OD may not.
func TestSetStrategyRequirement_PermissionMatrix(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := "CLI-A", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"owner AM", accountStaff(amID), true},
		{"other AM", accountStaff("EMP-OTHER"), false},
		{"account lead", accountLead("EMP-ALEAD"), true},
		{"director", directorActor("EMP-DIR"), true},
		{"OD", odActor("EMP-OD"), false},
		{"sales lead", salesLead("EMP-SL"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svcID := "SVC-" + c.name
			insertService(t, s, svcID, clientID, false, serviceStatusAwaitingOnboarding)
			_, err := s.SetStrategyRequirement(context.Background(), c.actor, svcID, true, "alasan")
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrOverrideForbidden) {
				t.Fatalf("expected ErrOverrideForbidden, got %v", err)
			}
		})
	}
}

// TestSetStrategyRequirement_Guards: reason mandatory, window = [Awaiting
// Onboarding] only, and an existing Strategy blocks the override.
func TestSetStrategyRequirement_Guards(t *testing.T) {
	s := newStrategySvc(t)
	clientID, amID := "CLI-A", "EMP-SINTA"
	insertClient(t, s, clientID, true)
	setAM(t, s, clientID, amID)

	// Reason required.
	insertService(t, s, "SVC-R", clientID, false, serviceStatusAwaitingOnboarding)
	if _, err := s.SetStrategyRequirement(context.Background(), accountStaff(amID), "SVC-R", true, "  "); !errors.Is(err, ErrOverrideReasonRequired) {
		t.Fatalf("want ErrOverrideReasonRequired, got %v", err)
	}

	// Not [Awaiting Onboarding] → rejected.
	insertService(t, s, "SVC-S", clientID, true, serviceStatusStrategyApproved)
	if _, err := s.SetStrategyRequirement(context.Background(), accountStaff(amID), "SVC-S", false, "alasan"); !errors.Is(err, ErrOverrideNotAwaiting) {
		t.Fatalf("want ErrOverrideNotAwaiting, got %v", err)
	}

	// Missing service → not found.
	if _, err := s.SetStrategyRequirement(context.Background(), accountStaff(amID), "SVC-NOPE", true, "alasan"); !errors.Is(err, ErrServiceNotFound) {
		t.Fatalf("want ErrServiceNotFound, got %v", err)
	}

	// Existing Strategy blocks the override.
	planGatedFixtureAt(t, s, "CLI-A", "SVC-P", amID)
	createDrafted(t, s, amID, "SVC-P")
	if _, err := s.SetStrategyRequirement(context.Background(), accountStaff(amID), "SVC-P", false, "alasan"); !errors.Is(err, ErrStrategyExists) {
		t.Fatalf("want ErrStrategyExists, got %v", err)
	}
}

// planGatedFixtureAt seeds a plan-gated awaiting Service on an existing client.
func planGatedFixtureAt(t *testing.T, s *Service, clientID, svcID, amID string) {
	t.Helper()
	insertService(t, s, svcID, clientID, true, serviceStatusAwaitingOnboarding)
}
