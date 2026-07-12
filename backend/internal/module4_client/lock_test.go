package module4_client

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// layered builds an actor with an underlying division account plus a layered role.
func layered(id, division, level string, od, director bool) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: division, Level: level, OD: od, Director: director}}
}

// TestLockMatrixContract exercises every M4 §4 row: an allow case and a deny
// case per field, including layered OD/Director.
func TestLockMatrixContract(t *testing.T) {
	sStaff := salesStaff("S1")
	sLead := salesLead("S2")
	aStaff := accountStaff("A1")
	aLead := accountLead("A2")
	od := odActor("O1")
	dir := directorActor("D1")

	cases := []struct {
		field   string
		allowed []permission.Actor
		denied  []permission.Actor
	}{
		// Never editable — not even Director.
		{FieldClientID, nil, []permission.Actor{sStaff, sLead, aStaff, aLead, od, dir}},
		{FieldOriginCampaign, nil, []permission.Actor{sStaff, sLead, aStaff, aLead, od, dir}},
		{FieldTransactionID, nil, []permission.Actor{sStaff, sLead, aStaff, aLead, od, dir}},
		{FieldSalesAllocation, nil, []permission.Actor{sStaff, sLead, aStaff, aLead, od, dir}},
		{FieldServiceSet, nil, []permission.Actor{sStaff, sLead, aStaff, aLead, od, dir}},
		{FieldTotalSales, nil, []permission.Actor{sStaff, sLead, aStaff, aLead, od, dir}},
		// Profile corrections — Account Lead OR OD OR Director (M4-OA-4).
		{FieldNamaPIC, []permission.Actor{aLead, od, dir}, []permission.Actor{sStaff, sLead, aStaff}},
		{FieldToko, []permission.Actor{aLead, od, dir}, []permission.Actor{sStaff, sLead, aStaff}},
		{FieldKota, []permission.Actor{aLead, od, dir}, []permission.Actor{sStaff, sLead, aStaff}},
		{FieldLinkToko, []permission.Actor{aLead, od, dir}, []permission.Actor{sStaff, sLead, aStaff}},
		{FieldKategori, []permission.Actor{aLead, od, dir}, []permission.Actor{sStaff, sLead, aStaff}},
		{FieldPlatformList, []permission.Actor{aLead, od, dir}, []permission.Actor{sStaff, sLead, aStaff}},
		// Baseline GMV — OD OR Director only.
		{FieldGMVBaseline, []permission.Actor{od, dir}, []permission.Actor{sStaff, sLead, aStaff, aLead}},
		// Target GMV / Marketing Budget — any Account OR Director.
		{FieldTargetGMV, []permission.Actor{aStaff, aLead, dir}, []permission.Actor{sStaff, sLead, od}},
		{FieldMarketingBudget, []permission.Actor{aStaff, aLead, dir}, []permission.Actor{sStaff, sLead, od}},
		// Sales PIC / Commission PIC reassign — Sales Lead OR Director.
		{FieldSalesPIC, []permission.Actor{sLead, dir}, []permission.Actor{sStaff, aStaff, aLead, od}},
		{FieldCommissionPIC, []permission.Actor{sLead, dir}, []permission.Actor{sStaff, aStaff, aLead, od}},
	}
	for _, c := range cases {
		for _, a := range c.allowed {
			if !CanEdit(a, c.field) {
				t.Errorf("%s: %+v should be allowed", c.field, a.Role)
			}
		}
		for _, a := range c.denied {
			if CanEdit(a, c.field) {
				t.Errorf("%s: %+v should be denied", c.field, a.Role)
			}
		}
	}

	// Layered role: Account staff + OD gets profile/baseline via OD, target via
	// Account; but a layered role never grants a never-editable field.
	as := layered("L1", AccountDivision, permission.LevelStaff, true, false)
	if !CanEdit(as, FieldNamaPIC) || !CanEdit(as, FieldGMVBaseline) || !CanEdit(as, FieldTargetGMV) {
		t.Errorf("Account+OD should edit profile/baseline/target")
	}
	if CanEdit(as, FieldTotalSales) || CanEdit(as, FieldClientID) {
		t.Errorf("Account+OD must not edit auto/immutable fields")
	}
	// Sales staff + Director may edit sales PIC (Director scope).
	sd := layered("L2", SalesDivision, permission.LevelStaff, false, true)
	if !CanEdit(sd, FieldSalesPIC) {
		t.Errorf("Sales+Director should edit sales_pic_id")
	}
}

func TestEditAppliesAndAudits(t *testing.T) {
	s := newService(t)
	seedAlphaDigital(t, s)
	ctx := context.Background()
	id := "CLI-202605-0021"
	// Account only ever acts on a RELEASED client (M4 §6) — the row-lock probe
	// now applies the same visibility(actor) gate as Get/List (FIX1), so the
	// Account Lead / Account staff edits below need this client released. The
	// Account STAFF edits also require the client be ASSIGNED to that staffer
	// (M4 §6 Rule 3 assigned-granularity, W2-M6-C1); Account Lead sees all
	// released clients regardless.
	if _, err := s.DB.ExecContext(ctx,
		`UPDATE clients SET released_to_account_at = NOW(), assigned_am_id = 'A1' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}

	// Account Lead corrects a profile field (logged).
	applied, err := s.Edit(ctx, accountLead("A2"), id, map[string]string{FieldToko: "Alpha Digital Official"})
	if err != nil {
		t.Fatalf("Edit toko (account lead): %v", err)
	}
	if len(applied) != 1 || applied[0].Before != "Alpha Digital" || applied[0].After != "Alpha Digital Official" {
		t.Fatalf("applied = %+v", applied)
	}
	var toko string
	s.DB.QueryRowContext(ctx, `SELECT toko FROM clients WHERE id = ?`, id).Scan(&toko)
	if toko != "Alpha Digital Official" {
		t.Errorf("toko not persisted: %q", toko)
	}
	// Audit row written before→after.
	entries, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "client", EntityID: id})
	if len(entries) != 1 {
		t.Fatalf("audit entries = %d, want 1", len(entries))
	}

	// Account STAFF cannot correct a profile field.
	if _, err := s.Edit(ctx, accountStaff("A1"), id, map[string]string{FieldKota: "Jakarta"}); !errors.Is(err, ErrFieldLocked) {
		t.Fatalf("account staff profile edit err = %v, want ErrFieldLocked", err)
	}
	// Nobody may write Total Sales (auto) or immutable Client ID — even Director.
	if _, err := s.Edit(ctx, directorActor("D1"), id, map[string]string{FieldTotalSales: "999"}); !errors.Is(err, ErrFieldLocked) {
		t.Fatalf("total_sales edit err = %v, want ErrFieldLocked", err)
	}
	if _, err := s.Edit(ctx, directorActor("D1"), id, map[string]string{FieldClientID: "CLI-HACK"}); !errors.Is(err, ErrFieldLocked) {
		t.Fatalf("client_id edit err = %v, want ErrFieldLocked", err)
	}

	// Money field revised by Account staff — stored as DECIMAL, but the
	// RETURNED FieldChange renders the house IDR convention (CLAUDE.md #7).
	moneyApplied, err := s.Edit(ctx, accountStaff("A1"), id, map[string]string{FieldTargetGMV: "150000000"})
	if err != nil {
		t.Fatalf("target_gmv edit: %v", err)
	}
	if moneyApplied[0].Before != "Rp. 100.000.000,00" || moneyApplied[0].After != "Rp. 150.000.000,00" {
		t.Errorf("target_gmv FieldChange = %+v, want house-formatted before/after", moneyApplied[0])
	}
	var target string
	s.DB.QueryRowContext(ctx, `SELECT target_gmv FROM clients WHERE id = ?`, id).Scan(&target)
	if target != "150000000.00" {
		t.Errorf("target_gmv = %q, want 150000000.00 (canonical decimal, unaffected by response formatting)", target)
	}
	// Sales Lead reassigns Sales PIC.
	if _, err := s.Edit(ctx, salesLead("S2"), id, map[string]string{FieldSalesPIC: "EMP-CITRA"}); err != nil {
		t.Fatalf("sales_pic reassign: %v", err)
	}
	// OD corrects the baseline (exceptional).
	if _, err := s.Edit(ctx, odActor("O1"), id, map[string]string{FieldGMVBaseline: "60000000"}); err != nil {
		t.Fatalf("od baseline correction: %v", err)
	}

	// Immutability: history accumulates, nothing is overwritten. Re-editing toko
	// leaves the earlier row intact and appends a new one whose Before is the
	// previous After.
	before := auditCount(t, s, id)
	applied, err = s.Edit(ctx, accountLead("A2"), id, map[string]string{FieldToko: "Alpha Digital Final"})
	if err != nil {
		t.Fatal(err)
	}
	if applied[0].Before != "Alpha Digital Official" {
		t.Errorf("second edit before = %q, want prior after", applied[0].Before)
	}
	if auditCount(t, s, id) != before+1 {
		t.Errorf("audit did not grow by exactly 1")
	}
}

func TestEditRejectsEmptyAndUnknown(t *testing.T) {
	s := newService(t)
	seedAlphaDigital(t, s)
	ctx := context.Background()
	id := "CLI-202605-0021"
	if _, err := s.Edit(ctx, directorActor("D1"), id, map[string]string{}); !errors.Is(err, ErrInvalidField) {
		t.Errorf("empty changes err = %v, want ErrInvalidField", err)
	}
	if _, err := s.Edit(ctx, directorActor("D1"), id, map[string]string{"gibberish": "x"}); !errors.Is(err, ErrInvalidField) {
		t.Errorf("unknown field err = %v, want ErrInvalidField", err)
	}
	// A batch with one denied field writes nothing (atomic validation).
	_, err := s.Edit(ctx, accountLead("A2"), id, map[string]string{FieldToko: "OK", FieldTotalSales: "1"})
	if !errors.Is(err, ErrFieldLocked) {
		t.Fatalf("mixed batch err = %v, want ErrFieldLocked", err)
	}
	var toko string
	s.DB.QueryRowContext(ctx, `SELECT toko FROM clients WHERE id = ?`, id).Scan(&toko)
	if toko != "Alpha Digital" {
		t.Errorf("denied batch must not partially apply; toko = %q", toko)
	}
}

// TestEditVisibilityGate (FIX1): the row-lock probe applies the SAME
// visibility(actor) predicate as Get/List — a client invisible to the actor
// must 404, not silently allow the write.
func TestEditVisibilityGate(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	insertClient(t, s, "CLI-UNREL", "EMP-BUDI", false)
	insertClient(t, s, "CLI-REL", "EMP-BUDI", true)
	// Account staff A1 owns CLI-REL (M4 §6 Rule 3 assigned-granularity, W2-M6-C1).
	assignAM(t, s, "CLI-REL", "A1")

	// (a) Account staff on a NON-released client: invisible -> ErrNotFound, the
	// exact regression this fix closes (previously silently allowed).
	if _, err := s.Edit(ctx, accountStaff("A1"), "CLI-UNREL", map[string]string{FieldTargetGMV: "1000000"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("account staff edit on unreleased client err = %v, want ErrNotFound", err)
	}

	// (b) The same actor, same field, on a RELEASED client ASSIGNED to them
	// still succeeds.
	if _, err := s.Edit(ctx, accountStaff("A1"), "CLI-REL", map[string]string{FieldTargetGMV: "1000000"}); err != nil {
		t.Fatalf("account staff edit on released+assigned client: %v", err)
	}
	// (b') An Account staffer who is NOT the assigned AM cannot see/edit it.
	if _, err := s.Edit(ctx, accountStaff("A-OTHER"), "CLI-REL", map[string]string{FieldTargetGMV: "1000000"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-assigned account staff edit err = %v, want ErrNotFound", err)
	}

	// (c) OD / Director see everything (visibility "1=1") — a non-released
	// client is still editable for the fields their role covers.
	if _, err := s.Edit(ctx, odActor("O1"), "CLI-UNREL", map[string]string{FieldGMVBaseline: "1000000"}); err != nil {
		t.Fatalf("od edit on unreleased client: %v", err)
	}
	if _, err := s.Edit(ctx, directorActor("D1"), "CLI-UNREL", map[string]string{FieldTargetGMV: "1000000"}); err != nil {
		t.Fatalf("director edit on unreleased client: %v", err)
	}
}

func auditCount(t *testing.T, s *Service, id string) int {
	t.Helper()
	entries, err := audit.List(context.Background(), s.DB, audit.Filter{EntityType: "client", EntityID: id})
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}
