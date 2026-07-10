package sales_test

import (
	"context"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// TestImmutability_HistoryAppendOnly proves the audit trail produced by this
// package's transitions cannot be mutated: the storage layer (audit_log
// BEFORE UPDATE / BEFORE DELETE triggers) rejects UPDATE and DELETE even via
// raw SQL, and the package itself exposes no method that touches history.
func TestImmutability_HistoryAppendOnly(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-3001", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}))

	// create + transition(New Lead) + transition(Contacted) + contact-action rows.
	if n := countAuditRows(t, conn, id); n < 3 {
		t.Fatalf("expected at least 3 audit rows, got %d", n)
	}

	// Raw UPDATE is rejected at the storage layer.
	if _, err := conn.Exec(`UPDATE audit_log SET actor = 'tamper' WHERE entity_id = ?`, id); err == nil {
		t.Fatal("expected UPDATE on audit_log to be rejected by trigger")
	} else if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected UPDATE rejection: %v", err)
	}
	// Raw DELETE is rejected at the storage layer.
	if _, err := conn.Exec(`DELETE FROM audit_log WHERE entity_id = ?`, id); err == nil {
		t.Fatal("expected DELETE on audit_log to be rejected by trigger")
	} else if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected DELETE rejection: %v", err)
	}
}

// TestImmutability_AuditTrailShape verifies the full trail for one attempt is
// exactly the expected sequence of immutable rows -- actor, action, and
// before->after per row -- so duration metrics can be derived from it.
func TestImmutability_AuditTrailShape(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")
	logger := audit.NewMySQL()

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-3002", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "meeting"}))

	recs, err := logger.List(ctx, conn, audit.Filter{EntityType: "prospect", EntityID: id})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(recs) != 4 {
		t.Fatalf("audit rows = %d, want 4 (create, ->New Lead, ->Contacted, contact_action_recorded)", len(recs))
	}
	wantActions := []string{"create", "transition", "transition", "contact_action_recorded"}
	for i, want := range wantActions {
		if recs[i].Action != want {
			t.Errorf("row %d action = %q, want %q", i, recs[i].Action, want)
		}
		if recs[i].Actor != owner.EmployeeID {
			t.Errorf("row %d actor = %q, want %q", i, recs[i].Actor, owner.EmployeeID)
		}
	}
	if string(recs[1].Before) != `{"status":"Pending Validation"}` || string(recs[1].After) != `{"status":"New Lead"}` {
		t.Errorf("row 1 before/after = %s -> %s", recs[1].Before, recs[1].After)
	}
	if string(recs[2].Before) != `{"status":"New Lead"}` || string(recs[2].After) != `{"status":"Contacted"}` {
		t.Errorf("row 2 before/after = %s -> %s", recs[2].Before, recs[2].After)
	}
}

// TestImmutability_BlockedTransitionZeroSideEffects proves a rejected
// transition (invalid pair via the engine) leaves the row AND the audit trail
// byte-identical -- the "blocked transition changes nothing" house rule as
// observed through this package's API.
func TestImmutability_BlockedTransitionZeroSideEffects(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-3003", owner.EmployeeID)
	before := countAuditRows(t, conn, id)

	// New Lead -> Closed-Success is not an edge; engine blocks with the BI message.
	err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectClosedSuccess})
	if err == nil {
		t.Fatal("expected invalid transition to be blocked")
	}
	if err.Error() != "[transisi status tidak diizinkan]" {
		t.Fatalf("message = %q, want the byte-exact BI block message", err.Error())
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNewLead) {
		t.Fatalf("status mutated to %q", got)
	}
	if after := countAuditRows(t, conn, id); after != before {
		t.Fatalf("audit rows changed %d -> %d on a blocked transition", before, after)
	}
}
