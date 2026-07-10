package module4_client

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// seedService creates a client + one service + the given briefs (id->status).
func seedService(t *testing.T, s *Service, clientID, serviceID, serviceStatus string, briefs map[string]string) {
	t.Helper()
	ctx := context.Background()
	insertClient(t, s, clientID, "EMP-BUDI", false, "EMP-BUDI")
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
		 VALUES (?, ?, 'MSV-01', 1, 'Jasa X', '5000000.00', '10% of standard price', ?, 'TEST')`,
		serviceID, clientID, serviceStatus); err != nil {
		t.Fatal(err)
	}
	for id, st := range briefs {
		if _, err := s.DB.ExecContext(ctx,
			`INSERT INTO briefs (id, service_id, title, status, created_by) VALUES (?, ?, 'Brief', ?, 'TEST')`,
			id, serviceID, st); err != nil {
			t.Fatal(err)
		}
	}
}

func briefStatus(t *testing.T, s *Service, id string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRowContext(context.Background(), `SELECT status FROM briefs WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func serviceStatus(t *testing.T, s *Service, id string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRowContext(context.Background(), `SELECT status FROM services WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestVoidServiceCascade(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	seedService(t, s, "CLI-V", "SVC-V", "[Briefed]", map[string]string{
		"BRF-1": "[To Do]",
		"BRF-2": "[In Progress]",
		"BRF-3": BriefApproved, // must be left intact
		"BRF-4": "[Submitted]",
	})

	res, err := s.VoidService(ctx, accountLead("A2"), "SVC-V")
	if err != nil {
		t.Fatalf("VoidService (account lead): %v", err)
	}
	if serviceStatus(t, s, "SVC-V") != StatusServiceVoided {
		t.Errorf("service not voided: %q", serviceStatus(t, s, "SVC-V"))
	}
	// Non-approved briefs cancelled; approved untouched.
	for _, id := range []string{"BRF-1", "BRF-2", "BRF-4"} {
		if got := briefStatus(t, s, id); got != StatusServiceVoided {
			t.Errorf("%s = %q, want voided", id, got)
		}
	}
	if got := briefStatus(t, s, "BRF-3"); got != BriefApproved {
		t.Errorf("approved brief was touched: %q", got)
	}
	if len(res.VoidedBriefs) != 3 || len(res.SkippedApproved) != 1 || res.SkippedApproved[0] != "BRF-3" {
		t.Errorf("result = %+v", res)
	}

	// Audit rows exist for the service and each cancelled brief; none for BRF-3.
	if len(auditFor(t, s, "service", "SVC-V")) == 0 {
		t.Errorf("missing service void audit")
	}
	for _, id := range []string{"BRF-1", "BRF-2", "BRF-4"} {
		if len(auditFor(t, s, "brief", id)) == 0 {
			t.Errorf("missing brief cancel audit for %s", id)
		}
	}
	if len(auditFor(t, s, "brief", "BRF-3")) != 0 {
		t.Errorf("approved brief must have no void audit")
	}

	// Nothing was deleted — all 4 brief rows persist.
	var n int
	s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM briefs WHERE service_id = 'SVC-V'`).Scan(&n)
	if n != 4 {
		t.Errorf("brief count = %d, want 4 (void never deletes)", n)
	}

	// Voided service is terminal: re-void is blocked with the BI message.
	_, err = s.VoidService(ctx, accountLead("A2"), "SVC-V")
	var blocked *statemachine.BlockedError
	if !errors.As(err, &blocked) || blocked.Message != statemachine.DefaultBlockMessage {
		t.Errorf("re-void err = %v, want BlockedError %q", err, statemachine.DefaultBlockMessage)
	}
}

func TestVoidServiceAuthorisation(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	seedService(t, s, "CLI-V", "SVC-V", "[Briefed]", map[string]string{"BRF-1": "[To Do]"})

	// Sales staff and OD are denied; the service stays [Briefed] and the brief
	// stays [To Do].
	for _, a := range []permission.Actor{salesStaff("S1"), odActor("O1"), accountStaff("A1")} {
		if _, err := s.VoidService(ctx, a, "SVC-V"); !errors.Is(err, ErrVoidForbidden) {
			t.Errorf("%+v void err = %v, want ErrVoidForbidden", a.Role, err)
		}
	}
	if serviceStatus(t, s, "SVC-V") != "[Briefed]" {
		t.Errorf("denied void must not change service status")
	}
	if briefStatus(t, s, "BRF-1") != "[To Do]" {
		t.Errorf("denied void must not touch briefs")
	}

	// Sales Lead may void.
	if _, err := s.VoidService(ctx, salesLead("S2"), "SVC-V"); err != nil {
		t.Fatalf("sales lead void: %v", err)
	}
	if serviceStatus(t, s, "SVC-V") != StatusServiceVoided {
		t.Errorf("sales lead void did not apply")
	}
}

func TestVoidServiceNotFound(t *testing.T) {
	s := newService(t)
	if _, err := s.VoidService(context.Background(), directorActor("D1"), "SVC-NOPE"); !errors.Is(err, ErrNotFound) {
		t.Errorf("void missing service err = %v, want ErrNotFound", err)
	}
}

func auditFor(t *testing.T, s *Service, entityType, id string) []audit.Entry {
	t.Helper()
	e, err := audit.List(context.Background(), s.DB, audit.Filter{EntityType: entityType, EntityID: id})
	if err != nil {
		t.Fatal(err)
	}
	return e
}
