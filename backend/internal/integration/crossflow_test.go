// Package integration holds the Wave 1 cross-stream end-to-end test — the core
// of the A↔B merge: registration → qualified (commission from MSL) → negotiation
// approval → closing (0002 rows born) → M5 verification → routing gate release
// → M4 lock matrix. It exercises M0, M1, M4, M5 and admin over one real deal.
package integration

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
	"github.com/meagrup/agencyapp/backend/internal/module4_client"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func actor(id, div, level string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: div, Level: level}}
}

// TestCrossFlow_MoneyPath is the end-to-end integration proof.
func TestCrossFlow_MoneyPath(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	engine := statemachine.New()
	catalog := notification.NewCatalog()
	leads := &module1_leads.Service{DB: d, Engine: engine}
	sales := &module0_sales.Service{DB: d, Engine: engine, Catalog: catalog, Win: leads.ResolveWin}
	finance := &module5_finance.Service{DB: d, Engine: engine}
	clients := &module4_client.Service{DB: d, Engine: engine}

	salesLead := actor("SL-1", "Sales", permission.LevelLead)
	salesStaff := actor("SS-1", "Sales", permission.LevelStaff)
	salesStaff2 := actor("SS-2", "Sales", permission.LevelStaff)
	financeStaff := actor("FS-1", "Finance", permission.LevelStaff)
	accountStaff := actor("AS-1", "Account", permission.LevelStaff)

	// --- MSL entry (commission source, W1-06) ---
	msvcID, err := admin.CreateService(ctx, d, salesLead, admin.ServiceInput{
		Name: "Ads Management", StandardPrice: "5000000", CommissionRule: "10% of standard price",
		Active: true, EffectiveFrom: "2026-01-01",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	// Master service list edit is guarded one level above the closer.
	if _, err := admin.CreateService(ctx, d, salesStaff, admin.ServiceInput{
		Name: "x", StandardPrice: "1", CommissionRule: "1% of standard price", Active: true, EffectiveFrom: "2026-01-01",
	}); err == nil {
		t.Fatal("plain salesperson must not create master services")
	}

	// --- M1 registration ---
	lead, att1, _, err := leads.Register(ctx, salesStaff, module1_leads.RegisterInput{
		LeadName: "Alpha Digital", PhoneNumber: "0811111111", Source: "Referral",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// --- M0 Contacted → Qualified (commission pinned from MSL) ---
	if err := sales.MarkContacted(ctx, salesStaff, att1.ID); err != nil {
		t.Fatalf("MarkContacted: %v", err)
	}
	form := module0_sales.QualifiedForm{
		NamaPIC: "Budi", Toko: "Alpha Store", Kota: "Jakarta", LinkToko: "https://shop/alpha",
		Kategori: "Fashion", Platform: "Shopee", StoreLink: "https://shopee/alpha",
		GMVBaseline: "10000000", TargetGMV: "50000000",
		Services: []module0_sales.ServiceSelection{{MasterServiceID: msvcID}},
	}
	if err := sales.SubmitQualifiedForm(ctx, salesStaff, att1.ID, form); err != nil {
		t.Fatalf("SubmitQualifiedForm: %v", err)
	}
	var pinnedRule string
	if err := d.QueryRowContext(ctx,
		`SELECT commission_rule FROM qualified_form_services WHERE attempt_id = ?`, att1.ID).Scan(&pinnedRule); err != nil {
		t.Fatalf("read pinned rule: %v", err)
	}
	if pinnedRule != "10% of standard price" {
		t.Fatalf("pinned commission_rule = %q, want 10%% of standard price", pinnedRule)
	}

	// --- M0 negotiation: only the owner submits; only a superior approves ---
	if err := sales.SubmitNegotiation(ctx, salesStaff2, att1.ID, nil, false); err == nil {
		t.Fatal("non-owner must not submit negotiation")
	}
	negoLines := []module0_sales.ProposalLine{{MasterServiceID: msvcID, ProposedPrice: "6000000", CommissionRule: "10% of standard price"}}
	if err := sales.SubmitNegotiation(ctx, salesStaff, att1.ID, negoLines, false); err != nil {
		t.Fatalf("SubmitNegotiation: %v", err)
	}
	if err := sales.DecideNegotiation(ctx, salesStaff, att1.ID, module0_sales.DecisionApprove, ""); err == nil {
		t.Fatal("plain salesperson must not approve a negotiation")
	}
	if err := sales.DecideNegotiation(ctx, salesLead, att1.ID, module0_sales.DecisionApprove, ""); err != nil {
		t.Fatalf("DecideNegotiation approve: %v", err)
	}

	// --- Pool contest: a second salesperson opens a competing attempt ---
	att2, err := leads.ClaimFromPool(ctx, salesStaff2, lead.ID)
	if err != nil {
		t.Fatalf("ClaimFromPool: %v", err)
	}

	// --- M0 Closing: births 0002 rows + fires win resolution ---
	res, err := sales.Close(ctx, salesStaff, att1.ID, module0_sales.ClosingInput{
		Parties: module0_sales.ClosingParties{
			PrimarySalespersonID: "SS-1",
			Allocations:          []module0_sales.Allocation{{SalespersonID: "SS-1", BasisPoints: 10000}},
		},
		PaymentScheme: module0_sales.PaymentSchemeTermin,
		Installments:  []module0_sales.InstallmentInput{{Amount: "6000000", DueDate: date(2026, 8, 1)}},
	})
	if err != nil {
		t.Fatalf("Close: %v", err)
	}

	// 0002 rows born, transaction awaiting verification.
	var status, total string
	if err := d.QueryRowContext(ctx,
		`SELECT payment_status, total_agreed_value FROM transactions WHERE id = ?`, res.TransactionID).
		Scan(&status, &total); err != nil {
		t.Fatalf("read trx: %v", err)
	}
	if status != "[Menunggu Verifikasi]" {
		t.Fatalf("trx status = %q, want [Menunggu Verifikasi]", status)
	}
	if total != "6000000.00" {
		t.Fatalf("total_agreed_value = %q, want 6000000.00", total)
	}

	// Win resolution: winner recorded, competitor closed as Kalah Kompetisi.
	assertAttemptStatus(t, d, att1.ID, "Closed-Success")
	assertAttemptStatus(t, d, att2.ID, "[Closed - Kalah Kompetisi]")
	var winner sql.NullString
	if err := d.QueryRowContext(ctx, `SELECT winning_attempt_id FROM leads WHERE id = ?`, lead.ID).Scan(&winner); err != nil {
		t.Fatalf("read winner: %v", err)
	}
	if winner.String != att1.ID {
		t.Fatalf("winning_attempt_id = %q, want %q", winner.String, att1.ID)
	}

	// --- Routing gate: client invisible to Account until first verification ---
	if _, err := clients.Get(ctx, accountStaff, res.ClientID); err == nil {
		t.Fatal("Account must not see client before routing gate release")
	}
	if _, err := clients.Get(ctx, salesStaff, res.ClientID); err != nil {
		t.Fatalf("Sales owner must see own client: %v", err)
	}

	// --- M5 verification releases to Account ---
	var instID string
	if err := d.QueryRowContext(ctx,
		`SELECT id FROM installments WHERE transaction_id = ? ORDER BY installment_no LIMIT 1`, res.TransactionID).
		Scan(&instID); err != nil {
		t.Fatalf("read installment: %v", err)
	}
	if err := finance.AttachContract(ctx, financeStaff, res.TransactionID, "https://contract/alpha.pdf"); err != nil {
		t.Fatalf("AttachContract: %v", err)
	}
	amt, _ := money.Parse("6000000")
	if _, err := finance.Verify(ctx, financeStaff, res.TransactionID, module5_finance.VerifyRequest{
		InstallmentID: instID, Amount: amt, ReceivedDate: date(2026, 8, 1),
	}); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	var released sql.NullTime
	if err := d.QueryRowContext(ctx, `SELECT released_to_account_at FROM clients WHERE id = ?`, res.ClientID).Scan(&released); err != nil {
		t.Fatalf("read release: %v", err)
	}
	if !released.Valid {
		t.Fatal("routing gate did not release client to Account")
	}

	// --- M4: Account now sees the client; lock matrix applies ---
	if _, err := clients.Get(ctx, accountStaff, res.ClientID); err != nil {
		t.Fatalf("Account must see released client: %v", err)
	}
	if !module4_client.CanEdit(salesLead, module4_client.FieldSalesPIC) {
		t.Fatal("Sales Lead may reassign Sales PIC")
	}
	if module4_client.CanEdit(accountStaff, module4_client.FieldSalesPIC) {
		t.Fatal("Account must not reassign Sales PIC")
	}
	if !module4_client.CanEdit(accountStaff, module4_client.FieldTargetGMV) {
		t.Fatal("Account may revise Target GMV")
	}
}

func assertAttemptStatus(t *testing.T, d *sql.DB, id, want string) {
	t.Helper()
	var got string
	if err := d.QueryRowContext(context.Background(), `SELECT status FROM prospect_attempts WHERE id = ?`, id).Scan(&got); err != nil {
		t.Fatalf("read attempt %s: %v", id, err)
	}
	if got != want {
		t.Fatalf("attempt %s status = %q, want %q", id, got, want)
	}
}

func date(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }
