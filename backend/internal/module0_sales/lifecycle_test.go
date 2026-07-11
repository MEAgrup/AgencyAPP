package sales_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// TestFullLifecycle_NoNegotiationToClosedSuccess drives the AC's "jalur
// sukses penuh sampai Closed-Success" fixture entirely through this
// package's public API: Create -> Contacted -> Qualified (via
// QualifyFromForm) -> No-Negotiation auto-approve -> Closed-Success.
func TestFullLifecycle_NoNegotiationToClosedSuccess(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-1001", owner.EmployeeID)
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNewLead)

	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}); err != nil {
		t.Fatalf("New Lead -> Contacted: %v", err)
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectContacted)

	if err := s.QualifyFromForm(ctx, conn, owner, id); err != nil {
		t.Fatalf("Contacted -> Qualified: %v", err)
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectQualified)

	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNegAutoApproved}); err != nil {
		t.Fatalf("Qualified -> Negotiation Auto Approved: %v", err)
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegAutoApproved)

	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectClosedSuccess}); err != nil {
		t.Fatalf("Negotiation Auto Approved -> Closed-Success: %v", err)
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectClosedSuccess)

	// Terminal: no further UpdateStatus succeeds.
	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNewLead}); err == nil {
		t.Fatal("expected terminal Closed-Success to reject any further transition")
	}
}

// TestFullLifecycle_NegotiationApprovalToClosedSuccess covers the
// Superior-approval branch: Qualified -> Pending Approval -> Approved (Sales
// Head/SPV only) -> Closed-Success.
func TestFullLifecycle_NegotiationApprovalToClosedSuccess(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-citra")
	spv := spvActor("spv-nia")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-1002", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "meeting"}))
	requireOK(t, s.QualifyFromForm(ctx, conn, owner, id))
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNegPendingApprove}))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegPendingApprove)

	// Plain staff (even the owner) cannot approve their own negotiation --
	// approval is a Sales Head/SPV-only edge (engine ActorRoles gate).
	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNegApproved}); err == nil {
		t.Fatal("expected owner-staff negotiation approval to be role-denied")
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegPendingApprove) // unchanged

	requireOK(t, s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: statemachine.ProspectNegApproved}))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegApproved)

	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectClosedSuccess}))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectClosedSuccess)
}

// TestFullLifecycle_RevisionRequiredLoop covers Revision Required -> accept
// (-> Approved) and Revision Required -> resubmit (-> Pending Approval, new
// version).
func TestFullLifecycle_RevisionRequiredLoop(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-doni")
	spv := spvActor("spv-nia")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-1003", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "chat"}))
	requireOK(t, s.QualifyFromForm(ctx, conn, owner, id))
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNegPendingApprove}))
	requireOK(t, s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: statemachine.ProspectNegRevisionReq}))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegRevisionReq)

	// Resubmit: back to Pending Approval (new version, salesperson-driven).
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNegPendingApprove}))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegPendingApprove)

	// Revision again, this time accepted straight to Approved.
	// NOTE: machines.go encodes the accept-revision edge (Revision Required
	// -> Approved) as RoleLeadSPV-only, while the M0 §5 prose says the
	// salesperson "accepts" the counter-offer (values synced by the system).
	// The engine config is authoritative and out of this ticket's scope
	// (JANGAN ubah machines.go); flagged as an open DECISIONS.md question in
	// the ticket report. Tested here per the engine's actual encoding.
	requireOK(t, s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: statemachine.ProspectNegRevisionReq}))
	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectNegApproved}); err == nil {
		t.Fatal("expected staff accept-revision to be role-denied per the engine's current encoding (see note above)")
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegRevisionReq) // unchanged after denial
	requireOK(t, s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: statemachine.ProspectNegApproved}))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNegApproved)
}

// TestClosedLost_OnlyFromNegotiationRejected pins DECISIONS.md O11: the ONLY
// path to Closed-Lost is Negotiation - Rejected. A Not Qualified attempt (the
// other pre-negotiation "loss" outcome) can never reach Closed-Lost.
func TestClosedLost_OnlyFromNegotiationRejected(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-eka")
	spv := spvActor("spv-nia")

	// Path A: Negotiation - Rejected -> Closed-Lost succeeds.
	idA := mustCreate(ctx, t, conn, s, "LEAD-202607-1004", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, idA, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "visit"}))
	requireOK(t, s.QualifyFromForm(ctx, conn, owner, idA))
	requireOK(t, s.UpdateStatus(ctx, conn, owner, idA, sales.UpdateStatusInput{To: statemachine.ProspectNegPendingApprove}))
	requireOK(t, s.UpdateStatus(ctx, conn, spv, idA, sales.UpdateStatusInput{To: statemachine.ProspectNegRejected}))
	assertStatus(t, ctx, conn, s, owner, idA, statemachine.ProspectNegRejected)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, idA, sales.UpdateStatusInput{To: statemachine.ProspectClosedLost}))
	assertStatus(t, ctx, conn, s, owner, idA, statemachine.ProspectClosedLost)

	// Path B: Not Qualified can NEVER reach Closed-Lost.
	idB := mustCreate(ctx, t, conn, s, "LEAD-202607-1005", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, idB, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}))
	requireOK(t, s.UpdateStatus(ctx, conn, owner, idB, sales.UpdateStatusInput{To: statemachine.ProspectNotQualified, NotQualifiedReason: "[Bukan seller]"}))
	assertStatus(t, ctx, conn, s, owner, idB, statemachine.ProspectNotQualified)
	if err := s.UpdateStatus(ctx, conn, owner, idB, sales.UpdateStatusInput{To: statemachine.ProspectClosedLost}); err == nil {
		t.Fatal("expected Not Qualified -> Closed-Lost to be blocked (O11: only Negotiation - Rejected leads to Closed-Lost)")
	}
	assertStatus(t, ctx, conn, s, owner, idB, statemachine.ProspectNotQualified) // unchanged

	att, err := s.GetAttempt(ctx, conn, owner, idB)
	if err != nil {
		t.Fatalf("GetAttempt: %v", err)
	}
	if att.NotQualifiedReason == nil || *att.NotQualifiedReason != "[Bukan seller]" {
		t.Fatalf("expected stored not-qualified reason, got %+v", att.NotQualifiedReason)
	}
}

// TestDirectQualifyDeniedViaUpdateStatus pins the ticket's explicit rule:
// UpdateStatus must reject To=Qualified outright, with zero side effects --
// Qualified is reachable ONLY through QualifyFromForm (W1-06's entry point).
func TestDirectQualifyDeniedViaUpdateStatus(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-fajar")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-1006", owner.EmployeeID)
	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}))

	before := countAuditRows(t, conn, id)
	err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectQualified})
	var denied sales.DirectQualifyDeniedError
	if !errors.As(err, &denied) {
		t.Fatalf("expected DirectQualifyDeniedError, got %v (%T)", err, err)
	}
	if err.Error() != "[transisi status tidak diizinkan]" {
		t.Errorf("message = %q", err.Error())
	}
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectContacted) // unchanged
	if after := countAuditRows(t, conn, id); after != before {
		t.Errorf("audit rows changed from %d to %d on a rejected direct-qualify call", before, after)
	}

	// QualifyFromForm is the only door through, and it works from Contacted.
	requireOK(t, s.QualifyFromForm(ctx, conn, owner, id))
	assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectQualified)
}

// TestContacted_RequiresRealActionType pins M0 §4 rule 1: New Lead ->
// Contacted must carry a real action (call/chat/meeting/visit).
func TestContacted_RequiresRealActionType(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-gita")
	id := mustCreate(ctx, t, conn, s, "LEAD-202607-1007", owner.EmployeeID)

	cases := []string{"", "email", "smoke signal"}
	for _, actionType := range cases {
		t.Run(fmt.Sprintf("action=%q", actionType), func(t *testing.T) {
			err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: actionType})
			var ve *sales.ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("expected *ValidationError, got %v", err)
			}
			assertStatus(t, ctx, conn, s, owner, id, statemachine.ProspectNewLead) // unchanged
		})
	}

	requireOK(t, s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "visit"}))
	att, err := s.GetAttempt(ctx, conn, owner, id)
	if err != nil {
		t.Fatalf("GetAttempt: %v", err)
	}
	if att.ContactActionType == nil || *att.ContactActionType != "visit" {
		t.Fatalf("expected recorded contact action type 'visit', got %+v", att.ContactActionType)
	}
}

// TestBlockedAttempt_AllActionsDenied pins M0 §4 rule 2: a Blocked attempt
// rejects every action -- UpdateStatus (any target) and QualifyFromForm --
// with zero side effects.
func TestBlockedAttempt_AllActionsDenied(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-hana")
	spv := spvActor("spv-nia")
	id := "PRSP-999999-0001"
	seedAttemptAt(t, conn, id, "LEAD-202607-9001", owner.EmployeeID, string(statemachine.ProspectBlocked))

	before := countAuditRows(t, conn, id)
	targets := []statemachine.Status{
		statemachine.ProspectNewLead, statemachine.ProspectContacted, statemachine.ProspectNotQualified,
		statemachine.ProspectQualified, statemachine.ProspectClosedSuccess, statemachine.ProspectClosedLost,
	}
	for _, to := range targets {
		if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: to, ActionType: "call"}); err == nil {
			t.Errorf("Blocked -> %s: expected denial, got success", to)
		}
		if err := s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: to, ActionType: "call"}); err == nil {
			t.Errorf("Blocked -> %s (spv): expected denial, got success", to)
		}
	}
	if err := s.QualifyFromForm(ctx, conn, owner, id); err == nil {
		t.Error("QualifyFromForm on Blocked attempt: expected denial, got success")
	}

	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectBlocked) {
		t.Fatalf("status mutated to %q, want unchanged Blocked", got)
	}
	if after := countAuditRows(t, conn, id); after != before {
		t.Errorf("audit rows changed from %d to %d on a Blocked attempt", before, after)
	}
}

// TestAutoEdgesOnlySystemActor pins the auto-edge guarantee from this
// package's own API surface: a human actor via UpdateStatus is blocked
// (zero side effects), while SystemTransition (used by module1_leads' win
// resolution and, for the Pending Validation -> Blocked edge, an intake
// collision) succeeds.
func TestAutoEdgesOnlySystemActor(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-indra")

	cases := []struct {
		name string
		from statemachine.Status
		to   statemachine.Status
	}{
		{"intake collision", statemachine.ProspectPendingValidation, statemachine.ProspectBlocked},
		{"kalah kompetisi from New Lead", statemachine.ProspectNewLead, statemachine.ProspectClosedKalah},
		{"kalah kompetisi from Contacted", statemachine.ProspectContacted, statemachine.ProspectClosedKalah},
		{"kalah kompetisi from Qualified", statemachine.ProspectQualified, statemachine.ProspectClosedKalah},
		{"kalah kompetisi from Negotiation Pending Approval", statemachine.ProspectNegPendingApprove, statemachine.ProspectClosedKalah},
		{"kalah kompetisi from Negotiation Revision Required", statemachine.ProspectNegRevisionReq, statemachine.ProspectClosedKalah},
		{"kalah kompetisi from Negotiation Approved", statemachine.ProspectNegApproved, statemachine.ProspectClosedKalah},
		{"kalah kompetisi from Negotiation Auto Approved", statemachine.ProspectNegAutoApproved, statemachine.ProspectClosedKalah},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			humanID := fmt.Sprintf("PRSP-999998-%04d", i*2+1)
			systemID := fmt.Sprintf("PRSP-999998-%04d", i*2+2)
			seedAttemptAt(t, conn, humanID, "LEAD-202607-9002", owner.EmployeeID, string(c.from))
			seedAttemptAt(t, conn, systemID, "LEAD-202607-9002", owner.EmployeeID, string(c.from))

			// Human actor via UpdateStatus: blocked, zero side effects.
			if err := s.UpdateStatus(ctx, conn, owner, humanID, sales.UpdateStatusInput{To: c.to}); err == nil {
				t.Errorf("%s: human actor should be blocked from auto edge %s->%s", c.name, c.from, c.to)
			}
			if got := rawStatus(t, conn, humanID); got != string(c.from) {
				t.Errorf("%s: human attempt mutated status to %q", c.name, got)
			}

			// System actor via SystemTransition: succeeds.
			if err := s.SystemTransition(ctx, conn, systemID, c.to); err != nil {
				t.Fatalf("%s: SystemTransition: %v", c.name, err)
			}
			if got := rawStatus(t, conn, systemID); got != string(c.to) {
				t.Errorf("%s: system attempt status = %q, want %q", c.name, got, c.to)
			}
		})
	}
}

// TestAllowedTransitionSweepViaAPI drives EVERY non-auto edge declared for
// the Prospect attempt machine (docs/STATE_MACHINES.md §1) through this
// package's own public API (QualifyFromForm for ->Qualified, UpdateStatus for
// everything else), seeding each attempt directly at the edge's From status.
// This is the ticket's core AC: every §1 transition tested through the
// sales package's API, not just the shared engine directly.
func TestAllowedTransitionSweepViaAPI(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	spv := spvActor("spv-nia") // division-wide write + holds RoleLeadSPV, so role-gated edges pass too

	m, ok := statemachine.Lookup(statemachine.EntityProspect)
	if !ok {
		t.Fatal("prospect machine not registered")
	}

	seen := 0
	for i, tr := range m.Transitions {
		if tr.Auto {
			continue // covered by TestAutoEdgesOnlySystemActor
		}
		seen++
		tr := tr
		t.Run(fmt.Sprintf("%s->%s", tr.From, tr.To), func(t *testing.T) {
			id := fmt.Sprintf("PRSP-999997-%04d", i+1)
			seedAttemptAt(t, conn, id, "LEAD-202607-9003", spv.EmployeeID, string(tr.From))

			var err error
			switch tr.To {
			case statemachine.ProspectQualified:
				err = s.QualifyFromForm(ctx, conn, spv, id)
			case statemachine.ProspectContacted:
				err = s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: tr.To, ActionType: "call"})
			case statemachine.ProspectNotQualified:
				err = s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: tr.To, NotQualifiedReason: sales.NQReasonBukanSeller})
			default:
				err = s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: tr.To})
			}
			if err != nil {
				t.Fatalf("%s -> %s via API: %v", tr.From, tr.To, err)
			}
			if got := rawStatus(t, conn, id); got != string(tr.To) {
				t.Errorf("status = %q, want %q", got, tr.To)
			}
		})
	}
	if seen == 0 {
		t.Fatal("expected at least one non-auto transition in the prospect machine")
	}
	t.Logf("swept %d non-auto §1 transitions through the sales package API", seen)
}

// ---- small local test helpers -----------------------------------------------

func requireOK(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

func assertStatus(t *testing.T, ctx context.Context, conn *sql.DB, s *sales.Attempts, actor authz.Identity, id string, want statemachine.Status) {
	t.Helper()
	att, err := s.GetAttempt(ctx, conn, actor, id)
	if err != nil {
		t.Fatalf("GetAttempt(%s): %v", id, err)
	}
	if att.Status != want {
		t.Fatalf("status = %q, want %q", att.Status, want)
	}
}
