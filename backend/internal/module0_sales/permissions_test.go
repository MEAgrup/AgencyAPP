package sales_test

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// ---- M0 §7.1 role matrix: write paths ---------------------------------------

// Staff: own attempts only (create is handled by module1_leads' gate; here we
// cover update paths).
func TestPermissions_StaffOwnOnly(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")
	otherStaff := staffActor("sales-rian")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-2001", owner.EmployeeID)

	// Another Sales staff cannot update someone else's attempt.
	err := s.UpdateStatus(ctx, conn, otherStaff, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"})
	if !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("non-owner staff UpdateStatus: expected authz.ErrDenied, got %v", err)
	}
	if got := rawStatus(t, conn, id); got != string(statemachine.ProspectNewLead) {
		t.Fatalf("status mutated to %q by denied actor", got)
	}
	// Nor qualify it.
	if err := s.QualifyFromForm(ctx, conn, otherStaff, id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("non-owner staff QualifyFromForm: expected authz.ErrDenied, got %v", err)
	}
	// Nor read it.
	if _, err := s.GetAttempt(ctx, conn, otherStaff, id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("non-owner staff GetAttempt: expected authz.ErrDenied, got %v", err)
	}
	// Nor list the owner's workspace.
	if _, err := s.ListByOwner(ctx, conn, otherStaff, owner.EmployeeID); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("non-owner staff ListByOwner: expected authz.ErrDenied, got %v", err)
	}

	// The owner can do all of the above.
	if err := s.UpdateStatus(ctx, conn, owner, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}); err != nil {
		t.Fatalf("owner UpdateStatus: %v", err)
	}
	if _, err := s.GetAttempt(ctx, conn, owner, id); err != nil {
		t.Fatalf("owner GetAttempt: %v", err)
	}
	list, err := s.ListByOwner(ctx, conn, owner, owner.EmployeeID)
	if err != nil {
		t.Fatalf("owner ListByOwner: %v", err)
	}
	if len(list) != 1 || list[0].ProspectID != id {
		t.Fatalf("owner workspace = %+v, want exactly the one attempt", list)
	}

	// Staff from ANOTHER division (not Sales) is denied even for "own"
	// division-wide probes.
	if _, err := s.GetAttempt(ctx, conn, otherDivisionStaff("ads-lia"), id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("other-division staff GetAttempt: expected authz.ErrDenied, got %v", err)
	}
}

// Head/SPV Sales: division-wide read + write on any Sales attempt; but a
// Lead/SPV of another division has nothing.
func TestPermissions_SPVDivisionWide(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")
	spv := spvActor("spv-nia")
	adsLead := authz.Identity{EmployeeID: "ads-lead", Divisi: "Ads", Roles: []authz.Role{authz.RoleLeadSPV}}

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-2002", owner.EmployeeID)

	// Sales SPV can read and update any Sales attempt.
	if _, err := s.GetAttempt(ctx, conn, spv, id); err != nil {
		t.Fatalf("spv GetAttempt: %v", err)
	}
	if err := s.UpdateStatus(ctx, conn, spv, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "meeting"}); err != nil {
		t.Fatalf("spv UpdateStatus: %v", err)
	}
	if list, err := s.ListByOwner(ctx, conn, spv, owner.EmployeeID); err != nil || len(list) != 1 {
		t.Fatalf("spv ListByOwner: %v, %d rows", err, len(list))
	}

	// A Lead/SPV of a different division is denied across the board.
	if _, err := s.GetAttempt(ctx, conn, adsLead, id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("ads lead GetAttempt: expected authz.ErrDenied, got %v", err)
	}
	if err := s.UpdateStatus(ctx, conn, adsLead, id, sales.UpdateStatusInput{To: statemachine.ProspectNotQualified}); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("ads lead UpdateStatus: expected authz.ErrDenied, got %v", err)
	}
}

// OD: read-only everywhere -- reads succeed on any attempt, every write is
// denied. Layered OD (Staff+OD on one account) gains no write over foreign
// attempts either, but keeps its base-role rights over its own.
func TestPermissions_ODReadOnlyAndLayered(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")
	od := odActor("od-tami")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-2003", owner.EmployeeID)

	// Pure OD reads fine...
	if _, err := s.GetAttempt(ctx, conn, od, id); err != nil {
		t.Fatalf("od GetAttempt: %v", err)
	}
	if _, err := s.ListByOwner(ctx, conn, od, owner.EmployeeID); err != nil {
		t.Fatalf("od ListByOwner: %v", err)
	}
	if _, err := s.ListByLead(ctx, conn, od, "LEAD-202607-2003"); err != nil {
		t.Fatalf("od ListByLead: %v", err)
	}
	// ...but every write is denied.
	if err := s.UpdateStatus(ctx, conn, od, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("od UpdateStatus: expected authz.ErrDenied, got %v", err)
	}
	if err := s.QualifyFromForm(ctx, conn, od, id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("od QualifyFromForm: expected authz.ErrDenied, got %v", err)
	}

	// Layered Staff+OD on one account (house convention: OD is layered, not a
	// replacement): write over own attempt comes from the base Staff role;
	// write over a colleague's attempt stays denied (OD adds read, not write).
	layered := authz.Identity{EmployeeID: "sales-layer", Divisi: sales.DivisiSales, Roles: []authz.Role{authz.RoleStaff, authz.RoleOD}}
	ownID := mustCreate(ctx, t, conn, s, "LEAD-202607-2004", layered.EmployeeID)
	if err := s.UpdateStatus(ctx, conn, layered, ownID, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "chat"}); err != nil {
		t.Fatalf("layered staff+od own UpdateStatus: %v", err)
	}
	if err := s.UpdateStatus(ctx, conn, layered, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "chat"}); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("layered staff+od foreign UpdateStatus: expected authz.ErrDenied, got %v", err)
	}
	// And the layered OD role DOES grant read over the foreign attempt.
	if _, err := s.GetAttempt(ctx, conn, layered, id); err != nil {
		t.Fatalf("layered staff+od foreign GetAttempt: %v", err)
	}
}

// Director: full read + write everywhere.
func TestPermissions_DirectorFull(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")
	dir := directorActor("dir-nerissa")

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-2005", owner.EmployeeID)

	if _, err := s.GetAttempt(ctx, conn, dir, id); err != nil {
		t.Fatalf("director GetAttempt: %v", err)
	}
	if err := s.UpdateStatus(ctx, conn, dir, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "visit"}); err != nil {
		t.Fatalf("director UpdateStatus: %v", err)
	}
	if _, err := s.ListByOwner(ctx, conn, dir, owner.EmployeeID); err != nil {
		t.Fatalf("director ListByOwner: %v", err)
	}
	// Director may also take the role-gated negotiation edges (full access).
	if err := s.QualifyFromForm(ctx, conn, dir, id); err != nil {
		t.Fatalf("director QualifyFromForm: %v", err)
	}
}

// Unauthenticated / unmapped identity: denied on every read path with the
// typed authz denial.
func TestPermissions_UnmappedDenied(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	owner := staffActor("sales-budi")
	unmapped := authz.Identity{EmployeeID: "emp-404"}

	id := mustCreate(ctx, t, conn, s, "LEAD-202607-2006", owner.EmployeeID)

	if _, err := s.GetAttempt(ctx, conn, unmapped, id); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("unmapped GetAttempt: expected authz.ErrDenied, got %v", err)
	}
	if _, err := s.ListByOwner(ctx, conn, unmapped, owner.EmployeeID); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("unmapped ListByOwner: expected authz.ErrDenied, got %v", err)
	}
	if _, err := s.ListByLead(ctx, conn, unmapped, "LEAD-202607-2006"); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("unmapped ListByLead: expected authz.ErrDenied, got %v", err)
	}
	if err := s.UpdateStatus(ctx, conn, unmapped, id, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("unmapped UpdateStatus: expected authz.ErrDenied, got %v", err)
	}
}

// ListByLead on a contested (pool) lead: Staff sees only their own attempt;
// SPV/OD/Director see all attempts.
func TestPermissions_ListByLeadContested(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	s := newAttempts()
	budi := staffActor("sales-budi")
	rian := staffActor("sales-rian")

	const leadID = "LEAD-202607-2007"
	budiID := mustCreate(ctx, t, conn, s, leadID, budi.EmployeeID)
	rianID := mustCreate(ctx, t, conn, s, leadID, rian.EmployeeID)

	// Each staff sees only their own attempt on the contested lead.
	budiView, err := s.ListByLead(ctx, conn, budi, leadID)
	if err != nil {
		t.Fatalf("budi ListByLead: %v", err)
	}
	if len(budiView) != 1 || budiView[0].ProspectID != budiID {
		t.Fatalf("budi sees %+v, want only own attempt %s", budiView, budiID)
	}
	rianView, err := s.ListByLead(ctx, conn, rian, leadID)
	if err != nil {
		t.Fatalf("rian ListByLead: %v", err)
	}
	if len(rianView) != 1 || rianView[0].ProspectID != rianID {
		t.Fatalf("rian sees %+v, want only own attempt %s", rianView, rianID)
	}

	// SPV, OD, Director see both attempts.
	for _, actor := range []authz.Identity{spvActor("spv-nia"), odActor("od-tami"), directorActor("dir-nerissa")} {
		view, err := s.ListByLead(ctx, conn, actor, leadID)
		if err != nil {
			t.Fatalf("%s ListByLead: %v", actor.EmployeeID, err)
		}
		if len(view) != 2 {
			t.Fatalf("%s sees %d attempts, want 2", actor.EmployeeID, len(view))
		}
	}
}
