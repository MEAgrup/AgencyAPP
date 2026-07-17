package module0_sales_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func salesActor(id, level string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Sales", Level: level}}
}

type fixture struct {
	d     *sql.DB
	sales *module0_sales.Service
	leads *module1_leads.Service
	msvc  string
}

func setup(t *testing.T) fixture {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	engine := statemachine.New()
	cat := notification.NewCatalog()
	leads := &module1_leads.Service{DB: d, Engine: engine, Catalog: cat}
	sales := &module0_sales.Service{DB: d, Engine: engine, Catalog: cat, Win: leads.ResolveWin}
	msvc, err := admin.CreateService(context.Background(), d, salesActor("SL", permission.LevelLead), admin.ServiceInput{
		Name: "Ads", StandardPrice: "5000000", CommissionRule: "10% of standard price", Active: true, EffectiveFrom: "2026-01-01",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	return fixture{d: d, sales: sales, leads: leads, msvc: msvc}
}

func (f fixture) qualifiedAttempt(t *testing.T, owner permission.Actor, phone string) string {
	t.Helper()
	ctx := context.Background()
	_, att, _, err := f.leads.Register(ctx, owner, module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: phone, Source: "Referral"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := f.sales.MarkContacted(ctx, owner, att.ID); err != nil {
		t.Fatalf("MarkContacted: %v", err)
	}
	form := module0_sales.QualifiedForm{
		NamaPIC: "P", Toko: "T", Kota: "K", LinkToko: "L", Kategori: "C", Platform: "Shopee",
		GMVBaseline: "1000000", TargetGMV: "2000000",
		Services: []module0_sales.ServiceSelection{{MasterServiceID: f.msvc}},
	}
	if err := f.sales.SubmitQualifiedForm(ctx, owner, att.ID, form); err != nil {
		t.Fatalf("SubmitQualifiedForm: %v", err)
	}
	return att.ID
}

// TestQualified_PermissionMatrix: a non-owner staff cannot act on the attempt;
// the owner and the Sales Lead can.
func TestQualified_PermissionMatrix(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	other := salesActor("SS-2", permission.LevelStaff)

	_, att, _, err := f.leads.Register(ctx, owner, module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: "0812", Source: "Referral"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := f.sales.MarkContacted(ctx, other, att.ID); err == nil {
		t.Fatal("non-owner staff must not advance another's attempt")
	}
	if err := f.sales.MarkContacted(ctx, owner, att.ID); err != nil {
		t.Fatalf("owner MarkContacted: %v", err)
	}
	// Sales Lead has division-wide authority.
	if err := f.sales.SetNotQualified(ctx, salesActor("SL", permission.LevelLead), att.ID,
		[]string{module0_sales.NQTidakRespon}, ""); err != nil {
		t.Fatalf("lead SetNotQualified: %v", err)
	}
}

// TestQualified_CalculatorPinAndRecompute: a min_floor MSL service submitted
// with a quantity pins all calculator params + subtotal into
// qualified_form_services, and recomputing the subtotal from those pinned
// columns reproduces the stored value exactly (CLAUDE.md #4).
func TestQualified_CalculatorPinAndRecompute(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	engine := statemachine.New()
	cat := notification.NewCatalog()
	leads := &module1_leads.Service{DB: d, Engine: engine, Catalog: cat}
	sales := &module0_sales.Service{DB: d, Engine: engine, Catalog: cat, Win: leads.ResolveWin}
	lead := salesActor("SL", permission.LevelLead)
	owner := salesActor("SS-1", permission.LevelStaff)

	// min_floor: unit 150.000, floor 5. qty 7 -> 7 × 150.000 = 1.050.000.
	msvc, err := admin.CreateService(ctx, d, lead, admin.ServiceInput{
		Name: "Konten", StandardPrice: "150000", CommissionRule: "10% of standard price",
		PricingMode: "min_floor", MinQty: "5", Unit: "per produk", Active: true, EffectiveFrom: "2026-01-01",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	_, att, _, err := leads.Register(ctx, owner, module1_leads.RegisterInput{LeadName: "Co", PhoneNumber: "0899", Source: "Referral"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := sales.MarkContacted(ctx, owner, att.ID); err != nil {
		t.Fatalf("MarkContacted: %v", err)
	}
	form := module0_sales.QualifiedForm{
		NamaPIC: "P", Toko: "T", Kota: "K", LinkToko: "L", Kategori: "C", Platform: "Shopee",
		GMVBaseline: "1000000", TargetGMV: "2000000",
		Services: []module0_sales.ServiceSelection{{MasterServiceID: msvc, Quantity: 7}},
	}
	if err := sales.SubmitQualifiedForm(ctx, owner, att.ID, form); err != nil {
		t.Fatalf("SubmitQualifiedForm: %v", err)
	}

	var mode, unitPrice, subtotal, minQty string
	var qty float64
	var applyPPN int
	var inputAmount sql.NullString
	if err := d.QueryRowContext(ctx,
		`SELECT pricing_mode, standard_price, quantity, min_qty, apply_ppn, input_amount, subtotal
		   FROM qualified_form_services WHERE attempt_id = ?`, att.ID).
		Scan(&mode, &unitPrice, &qty, &minQty, &applyPPN, &inputAmount, &subtotal); err != nil {
		t.Fatalf("read pinned: %v", err)
	}
	if subtotal != "1050000.00" {
		t.Fatalf("pinned subtotal = %q, want 1050000.00", subtotal)
	}

	// Recompute from the pinned columns only.
	up, _ := money.Parse(unitPrice)
	mq, _ := money.Parse(minQty)
	recomputed, err := module0_sales.ComputeSubtotal(module0_sales.PriceParams{
		Mode: mode, UnitPrice: up, Quantity: int64(qty), MinQty: int64(mq) / 100, ApplyPPN: applyPPN == 1,
	})
	if err != nil {
		t.Fatalf("recompute: %v", err)
	}
	if recomputed.Decimal() != subtotal {
		t.Fatalf("recomputed %q != pinned %q", recomputed.Decimal(), subtotal)
	}
}

// TestNegotiation_SuperiorOnlyDecision: the salesperson submits; only Lead
// approves. Auto-approve (no-nego) bypasses the superior.
func TestNegotiation_SuperiorOnlyDecision(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	att := f.qualifiedAttempt(t, owner, "0813")

	lines := []module0_sales.ProposalLine{{MasterServiceID: f.msvc, ProposedPrice: "6000000", CommissionRule: "10% of standard price"}}
	if err := f.sales.SubmitNegotiation(ctx, owner, att, lines, false); err != nil {
		t.Fatalf("SubmitNegotiation: %v", err)
	}
	if err := f.sales.DecideNegotiation(ctx, owner, att, module0_sales.DecisionApprove, ""); err == nil {
		t.Fatal("staff must not approve")
	}
	if err := f.sales.DecideNegotiation(ctx, salesActor("SL", permission.LevelLead), att, module0_sales.DecisionApprove, ""); err != nil {
		t.Fatalf("lead approve: %v", err)
	}
}

// TestClose_RecomputeFromLog_AndImmutability: closing births 0002 rows; the
// transaction total recomputes from the proposal lines, and every status move
// is an append-only audit row (no raw status writes).
func TestClose_RecomputeFromLog_AndImmutability(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)
	att := f.qualifiedAttempt(t, owner, "0814")

	// No-nego auto-approve, then close solo Lunas.
	if err := f.sales.SubmitNegotiation(ctx, owner, att, nil, true); err != nil {
		t.Fatalf("SubmitNegotiation(noNego): %v", err)
	}
	res, err := f.sales.Close(ctx, owner, att, module0_sales.ClosingInput{
		Parties: module0_sales.ClosingParties{
			PrimarySalespersonID: "SS-1",
			Allocations:          []module0_sales.Allocation{{SalespersonID: "SS-1", BasisPoints: 10000}},
		},
		PaymentScheme: module0_sales.PaymentSchemeLunas,
	})
	if err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Recompute: transaction total == Σ proposal_price of the approved version.
	var total, lineSum string
	if err := f.d.QueryRowContext(ctx, `SELECT total_agreed_value FROM transactions WHERE id = ?`, res.TransactionID).Scan(&total); err != nil {
		t.Fatalf("read total: %v", err)
	}
	if err := f.d.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(npl.proposed_price),0) FROM negotiation_proposal_lines npl
		   JOIN negotiation_proposals np ON np.id = npl.proposal_id WHERE np.attempt_id = ?`, att).Scan(&lineSum); err != nil {
		t.Fatalf("sum lines: %v", err)
	}
	if total != "5000000.00" || lineSum != "5000000.00" {
		t.Fatalf("recompute mismatch: total=%q lineSum=%q want 5000000.00", total, lineSum)
	}

	// Immutability: the attempt's transition audit rows exist and cannot be
	// updated (storage-level guard fires).
	var n int
	if err := f.d.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM audit_log WHERE entity_type='prospect_attempt' AND entity_id=? AND action LIKE 'transition:%'`, att).Scan(&n); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if n < 3 { // Contacted, Qualified, Auto Approved, Closed-Success
		t.Fatalf("expected >=3 transition audit rows, got %d", n)
	}
	if _, err := f.d.ExecContext(ctx, `UPDATE audit_log SET action='x' WHERE entity_id=?`, att); err == nil {
		t.Fatal("audit_log must be immutable (UPDATE should be blocked)")
	}
}
