package sales_test

// W1-09 integration tests — Closing Form (M0 §6) against a real DB, real
// statemachine engine, real Master Service List, and a real module1_leads
// Service (so ResolveWin — M1 §6 rule 5 — fires in the closing transaction,
// not a fake). Covers: the Alpha Digital worked example, allocation Σ=100% /
// max-5 / PIC rules, the Termin sum gate, the "only from Approved" gate,
// atomic CLI-/TRX-/SVC-/INST- generation with zero orphans on failure, pool
// competition win resolution, the M4 §6 visibility matrix, and append-only
// immutability of the birth snapshots.

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	leads "github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

var (
	cliIDPattern  = regexp.MustCompile(`^CLI-\d{6}-\d{4,}$`)
	trxIDPattern  = regexp.MustCompile(`^TRX-\d{6}-\d{4,}$`)
	svcIDPattern  = regexp.MustCompile(`^SVC-\d{6}-\d{4,}$`)
	instIDPattern = regexp.MustCompile(`^INST-\d{6}-\d{4,}$`)
)

// closingEnv bundles the shared *Attempts, a real leads.Service wired to that
// same *Attempts as its AttemptCreator, and the Closing service under test.
type closingEnv struct {
	attempts *sales.Attempts
	leads    *leads.Service
	closing  *sales.Closing
}

func newClosingEnv() *closingEnv {
	a := newAttempts()
	l := leads.NewService(authz.NewMatrixChecker(), audit.NewMySQL(), ids.NewMySQL(), a, leads.DefaultNormalizer())
	// Bind win resolution to the real leads.Service with *sales.Attempts as the
	// CompetitionResolver — this closure is where both modules meet, keeping
	// module0_sales free of any module1_leads import.
	win := func(ctx context.Context, tx *sql.Tx, leadID, winningProspectID, winnerEmployeeID string, now time.Time) error {
		return l.ResolveWin(ctx, tx, a, leadID, winningProspectID, winnerEmployeeID, now)
	}
	return &closingEnv{attempts: a, leads: l, closing: sales.NewClosing(a, win)}
}

// registerAndApprove registers a real scouted lead as owner, qualifies it on
// the given services, and takes the non-negotiation path to
// `Negotiation - Auto Approved` (total = Σ standard prices). Returns the
// attempt id and lead id.
func (e *closingEnv) registerAndApprove(t *testing.T, conn *sql.DB, owner authz.Identity, leadName, phone string, svcIDs []int64) (prospectID, leadID string) {
	t.Helper()
	ctx := context.Background()
	reg, err := e.leads.RegisterSalesLead(ctx, conn, owner, leads.SalesRegistrationForm{
		LeadName: leadName, Phone: phone, Source: leads.SourceScouting,
	})
	if err != nil {
		t.Fatalf("RegisterSalesLead(%s): %v", leadName, err)
	}
	e.qualifyAndApprove(t, conn, owner, reg.ProspectID, svcIDs)
	return reg.ProspectID, reg.Lead.LeadID
}

// qualifyAndApprove drives an existing New-Lead attempt to
// `Negotiation - Auto Approved` on standard terms for the given services.
func (e *closingEnv) qualifyAndApprove(t *testing.T, conn *sql.DB, owner authz.Identity, prospectID string, svcIDs []int64) {
	t.Helper()
	ctx := context.Background()
	requireOK(t, e.attempts.UpdateStatus(ctx, conn, owner, prospectID, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "meeting"}))
	if _, err := e.attempts.SubmitQualifiedForm(ctx, conn, owner, prospectID, validQualifiedInput(svcIDs...)); err != nil {
		t.Fatalf("SubmitQualifiedForm(%s): %v", prospectID, err)
	}
	noNego := make([]sales.NoNegotiationServiceInput, 0, len(svcIDs))
	for _, id := range svcIDs {
		noNego = append(noNego, sales.NoNegotiationServiceInput{EntryID: id})
	}
	if _, err := e.attempts.SubmitNoNegotiation(ctx, conn, owner, prospectID, sales.NoNegotiationInput{Services: noNego}); err != nil {
		t.Fatalf("SubmitNoNegotiation(%s): %v", prospectID, err)
	}
}

func aliceContract() (time.Time, int) {
	return time.Date(2026, time.May, 1, 0, 0, 0, 0, time.UTC), 12
}

func soloClosing(owner string, scheme string, installments []sales.InstallmentInput) sales.ClosingInput {
	start, months := aliceContract()
	return sales.ClosingInput{
		Salespeople:            []sales.SalespersonAllocation{{EmployeeID: owner, BasisPoints: 10000}},
		ContractStartDate:      start,
		ContractDurationMonths: months,
		PaymentScheme:          scheme,
		Installments:           installments,
	}
}

func countRows(t *testing.T, conn *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// TestClosing_AlphaDigitalSolo reproduces the M0 §6 / M4 §3 worked example:
// Budi closes Alpha Digital solo on 3 services totalling Rp 21.900.000,00 with
// a Termin schedule, generating CLI-/TRX-/3×SVC-/3×INST- atomically, inheriting
// the locked Qualified identity/baseline, and firing win resolution.
func TestClosing_AlphaDigitalSolo(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	pid, leadID := e.registerAndApprove(t, conn, budi, "Alpha Digital", "0812 1000 0001", []int64{svc[0], svc[1], svc[2]})

	termin := []sales.InstallmentInput{
		{Amount: "7300000", DueDate: time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)},
		{Amount: "7300000", DueDate: time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)},
		{Amount: "7300000", DueDate: time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)},
	}
	client, err := e.closing.SubmitClosing(ctx, conn, budi, pid, soloClosing("sales-budi", sales.PaymentSchemeTermin, termin))
	if err != nil {
		t.Fatalf("SubmitClosing: %v", err)
	}

	if got := rawStatus(t, conn, pid); got != string(statemachine.ProspectClosedSuccess) {
		t.Errorf("attempt status = %q, want Closed-Success", got)
	}
	if !cliIDPattern.MatchString(client.ClientID) {
		t.Errorf("client id %q !~ CLI-YYYYMM-NNNN", client.ClientID)
	}
	if !trxIDPattern.MatchString(client.TransactionID) {
		t.Errorf("transaction id %q !~ TRX-YYYYMM-NNNN", client.TransactionID)
	}
	// Inherited locked Qualified identity/baseline (validQualifiedInput).
	if client.NamaToko != "Alpha Digital" || client.Kota != "Bandung" || client.NamaPIC != "Ibu Sari" {
		t.Errorf("identity not inherited: %+v", client)
	}
	if client.GMVSaatIni != "50000000.00" || client.TargetGMV != "150000000.00" {
		t.Errorf("baseline not inherited: gmv=%q target=%q", client.GMVSaatIni, client.TargetGMV)
	}
	// Solo close ⇒ Sales PIC = Commission PIC = Budi; allocation 100%.
	if client.SalesPIC != "sales-budi" || client.CommissionPaymentPIC != "sales-budi" {
		t.Errorf("PICs = %q / %q", client.SalesPIC, client.CommissionPaymentPIC)
	}
	if len(client.Allocations) != 1 || client.Allocations[0].BasisPoints != 10000 ||
		!client.Allocations[0].IsPrimary || !client.Allocations[0].IsCommissionPaymentPIC {
		t.Errorf("allocation = %+v", client.Allocations)
	}
	// 3 services, SVC ids, final price = Σ 21.900.000,00.
	if len(client.Services) != 3 {
		t.Fatalf("services = %d, want 3", len(client.Services))
	}
	for _, s := range client.Services {
		if !svcIDPattern.MatchString(s.ServiceID) {
			t.Errorf("service id %q !~ SVC-YYYYMM-NNNN", s.ServiceID)
		}
	}
	if client.TransactionTotalValue != "21900000.00" || client.TransactionTotalValueIDR() != "Rp. 21.900.000,00" {
		t.Errorf("transaction total = %q (%q)", client.TransactionTotalValue, client.TransactionTotalValueIDR())
	}
	if client.TransactionPaymentStatus != string(statemachine.TxnMenungguVerifikasi) {
		t.Errorf("payment status = %q, want [Menunggu Verifikasi]", client.TransactionPaymentStatus)
	}
	if client.PaymentIntentScheme != sales.PaymentSchemeTermin {
		t.Errorf("payment scheme = %q", client.PaymentIntentScheme)
	}
	if len(client.Installments) != 3 {
		t.Fatalf("installments = %d, want 3", len(client.Installments))
	}
	for _, inst := range client.Installments {
		if !instIDPattern.MatchString(inst.InstallmentID) {
			t.Errorf("installment id %q !~ INST-YYYYMM-NNNN", inst.InstallmentID)
		}
		if inst.Status != string(statemachine.InstBelumJatuhTempo) {
			t.Errorf("installment status = %q, want [Belum Jatuh Tempo]", inst.Status)
		}
	}
	// Win resolution fired: the lead is now a client, winner = Budi's attempt.
	lead, err := leads.GetLead(ctx, conn, leadID)
	if err != nil {
		t.Fatalf("GetLead: %v", err)
	}
	if lead.RecordStatus != leads.StatusClient || lead.WinningAttempt != pid || lead.WinningSalespersonID != "sales-budi" {
		t.Errorf("win not resolved: status=%q winner=%q sales=%q", lead.RecordStatus, lead.WinningAttempt, lead.WinningSalespersonID)
	}
}

// TestClosing_LunasNoSchedule: the Lunas scheme creates no installment rows.
func TestClosing_LunasNoSchedule(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	pid, _ := e.registerAndApprove(t, conn, budi, "Sini Store", "0812 1000 0002", []int64{svc[0]})

	client, err := e.closing.SubmitClosing(ctx, conn, budi, pid, soloClosing("sales-budi", sales.PaymentSchemeLunas, nil))
	if err != nil {
		t.Fatalf("SubmitClosing: %v", err)
	}
	if len(client.Installments) != 0 {
		t.Errorf("Lunas produced %d installments, want 0", len(client.Installments))
	}
	if client.TransactionTotalValue != "9000000.00" {
		t.Errorf("total = %q, want 9000000.00", client.TransactionTotalValue)
	}
}

// TestClosing_MultiSalespeople: >1 salesperson requires exactly one Commission
// & Payment PIC; the resolved PIC flag is stored on the right row.
func TestClosing_MultiSalespeople(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	pid, _ := e.registerAndApprove(t, conn, budi, "Duo Deal", "0812 1000 0003", []int64{svc[0], svc[1]})

	start, months := aliceContract()
	in := sales.ClosingInput{
		Salespeople: []sales.SalespersonAllocation{
			{EmployeeID: "sales-budi", BasisPoints: 6000},
			{EmployeeID: "sales-sinta", BasisPoints: 4000, IsCommissionPaymentPIC: true},
		},
		ContractStartDate:      start,
		ContractDurationMonths: months,
		PaymentScheme:          sales.PaymentSchemeSebagian,
	}
	client, err := e.closing.SubmitClosing(ctx, conn, budi, pid, in)
	if err != nil {
		t.Fatalf("SubmitClosing: %v", err)
	}
	if client.SalesPIC != "sales-budi" || client.CommissionPaymentPIC != "sales-sinta" {
		t.Errorf("PICs = %q / %q, want budi / sinta", client.SalesPIC, client.CommissionPaymentPIC)
	}
	var budiAlloc, sintaAlloc sales.SalesAllocationEntry
	for _, a := range client.Allocations {
		switch a.EmployeeID {
		case "sales-budi":
			budiAlloc = a
		case "sales-sinta":
			sintaAlloc = a
		}
	}
	if !budiAlloc.IsPrimary || budiAlloc.IsCommissionPaymentPIC {
		t.Errorf("budi alloc = %+v (want primary, not PIC)", budiAlloc)
	}
	if sintaAlloc.IsPrimary || !sintaAlloc.IsCommissionPaymentPIC {
		t.Errorf("sinta alloc = %+v (want PIC, not primary)", sintaAlloc)
	}
}

// TestClosing_ValidationBlocks covers the M0 §6 structural gates; each leaves
// ZERO side effects (attempt stays Auto Approved, no client/transaction rows).
func TestClosing_ValidationBlocks(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	start, months := aliceContract()

	cases := []struct {
		name    string
		in      sales.ClosingInput
		wantMsg string
	}{
		{"allocation != 100%", sales.ClosingInput{
			Salespeople: []sales.SalespersonAllocation{{EmployeeID: "sales-budi", BasisPoints: 5000}},
			ContractStartDate: start, ContractDurationMonths: months, PaymentScheme: sales.PaymentSchemeLunas,
		}, msg.DataTidakLengkap},
		{"more than 5 salespeople", sales.ClosingInput{
			Salespeople: []sales.SalespersonAllocation{
				{EmployeeID: "sales-budi", BasisPoints: 2000}, {EmployeeID: "s2", BasisPoints: 2000},
				{EmployeeID: "s3", BasisPoints: 2000}, {EmployeeID: "s4", BasisPoints: 2000},
				{EmployeeID: "s5", BasisPoints: 1000}, {EmployeeID: "s6", BasisPoints: 1000, IsCommissionPaymentPIC: true},
			},
			ContractStartDate: start, ContractDurationMonths: months, PaymentScheme: sales.PaymentSchemeLunas,
		}, msg.DataTidakLengkap},
		{"multi without PIC", sales.ClosingInput{
			Salespeople: []sales.SalespersonAllocation{
				{EmployeeID: "sales-budi", BasisPoints: 6000}, {EmployeeID: "sales-sinta", BasisPoints: 4000},
			},
			ContractStartDate: start, ContractDurationMonths: months, PaymentScheme: sales.PaymentSchemeLunas,
		}, msg.DataTidakLengkap},
		{"missing contract", sales.ClosingInput{
			Salespeople: []sales.SalespersonAllocation{{EmployeeID: "sales-budi", BasisPoints: 10000}},
			PaymentScheme: sales.PaymentSchemeLunas,
		}, msg.DataTidakLengkap},
		{"unknown scheme", sales.ClosingInput{
			Salespeople: []sales.SalespersonAllocation{{EmployeeID: "sales-budi", BasisPoints: 10000}},
			ContractStartDate: start, ContractDurationMonths: months, PaymentScheme: "[Cicilan]",
		}, msg.DataTidakLengkap},
		{"lunas with installments", sales.ClosingInput{
			Salespeople: []sales.SalespersonAllocation{{EmployeeID: "sales-budi", BasisPoints: 10000}},
			ContractStartDate: start, ContractDurationMonths: months, PaymentScheme: sales.PaymentSchemeLunas,
			Installments: []sales.InstallmentInput{{Amount: "9000000", DueDate: start}},
		}, msg.DataTidakLengkap},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// Fresh approved attempt per case so the "zero side effects" check is clean.
			pid, _ := e.registerAndApprove(t, conn, budi, "Blk "+c.name, phoneFor(c.name), []int64{svc[0]})
			_, err := e.closing.SubmitClosing(ctx, conn, budi, pid, c.in)
			var ve *sales.ValidationError
			if !errors.As(err, &ve) || ve.Message != c.wantMsg {
				t.Fatalf("err = %v, want ValidationError(%q)", err, c.wantMsg)
			}
			if got := rawStatus(t, conn, pid); got != string(statemachine.ProspectNegAutoApproved) {
				t.Errorf("attempt status mutated to %q", got)
			}
			if n := countRows(t, conn, `SELECT COUNT(*) FROM clients WHERE winning_prospect_id = ?`, pid); n != 0 {
				t.Errorf("blocked closing wrote %d client rows", n)
			}
		})
	}
}

// phoneFor derives a unique-enough phone per subtest name.
func phoneFor(name string) string {
	sum := 0
	for _, r := range name {
		sum += int(r)
	}
	return "0813" + padDigits(sum)
}

func padDigits(n int) string {
	s := ""
	for i := 0; i < 7; i++ {
		s = string(rune('0'+(n%10))) + s
		n /= 10
	}
	return s
}

// TestClosing_PrimaryMustBeInAllocation: the attempt owner (Primary) must be
// one of the allocation rows (M0 §6 rule 2).
func TestClosing_PrimaryMustBeInAllocation(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	pid, _ := e.registerAndApprove(t, conn, budi, "NoPrimary", "0812 1000 0009", []int64{svc[0]})

	in := soloClosing("sales-andi", sales.PaymentSchemeLunas, nil) // owner budi absent
	_, err := e.closing.SubmitClosing(ctx, conn, budi, pid, in)
	var ve *sales.ValidationError
	if !errors.As(err, &ve) || ve.Message != msg.DataTidakLengkap {
		t.Fatalf("err = %v, want mandatory-field ValidationError", err)
	}
	if got := rawStatus(t, conn, pid); got != string(statemachine.ProspectNegAutoApproved) {
		t.Errorf("attempt mutated to %q", got)
	}
}

// TestClosing_TerminSumMismatch: the byte-exact M5 §4 message when the
// schedule does not sum to the transaction total, zero side effects.
func TestClosing_TerminSumMismatch(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	pid, _ := e.registerAndApprove(t, conn, budi, "BadTermin", "0812 1000 0010", []int64{svc[0]}) // total 9.000.000

	in := soloClosing("sales-budi", sales.PaymentSchemeTermin, []sales.InstallmentInput{
		{Amount: "5000000", DueDate: time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)},
		{Amount: "3000000", DueDate: time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)}, // sums to 8jt, not 9jt
	})
	_, err := e.closing.SubmitClosing(ctx, conn, budi, pid, in)
	var ve *sales.ValidationError
	if !errors.As(err, &ve) || ve.Message != "[total termin tidak sama dengan nilai transaksi]" {
		t.Fatalf("err = %v, want [total termin tidak sama dengan nilai transaksi]", err)
	}
	if n := countRows(t, conn, `SELECT COUNT(*) FROM transactions`); n != 0 {
		t.Errorf("mismatch wrote %d transactions", n)
	}
}

// TestClosing_OnlyFromApproved: closing a non-approved attempt is blocked by
// the engine with the standard BI transition message and zero side effects.
func TestClosing_OnlyFromApproved(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	// Register + qualify only (NOT negotiated/approved).
	reg, err := e.leads.RegisterSalesLead(ctx, conn, budi, leads.SalesRegistrationForm{
		LeadName: "NotApproved", Phone: "0812 1000 0011", Source: leads.SourceScouting,
	})
	if err != nil {
		t.Fatal(err)
	}
	pid := reg.ProspectID
	requireOK(t, e.attempts.UpdateStatus(ctx, conn, budi, pid, sales.UpdateStatusInput{To: statemachine.ProspectContacted, ActionType: "call"}))
	if _, err := e.attempts.SubmitQualifiedForm(ctx, conn, budi, pid, validQualifiedInput(svc[0])); err != nil {
		t.Fatal(err)
	}

	_, err = e.closing.SubmitClosing(ctx, conn, budi, pid, soloClosing("sales-budi", sales.PaymentSchemeLunas, nil))
	var be *statemachine.BlockedError
	if !errors.As(err, &be) || be.Message != msg.TransisiTidakDiizinkan {
		t.Fatalf("err = %v, want BlockedError transisi", err)
	}
	if got := rawStatus(t, conn, pid); got != string(statemachine.ProspectQualified) {
		t.Errorf("attempt mutated to %q", got)
	}
	if n := countRows(t, conn, `SELECT COUNT(*) FROM clients`); n != 0 {
		t.Errorf("blocked close wrote %d clients", n)
	}
}

// TestClosing_Permissions covers the M0 §7.1 write matrix on SubmitClosing and
// the M4 §6 read matrix on GetClient.
func TestClosing_Permissions(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")

	// Write denials on a fresh approved attempt (each denial leaves it intact).
	pid, _ := e.registerAndApprove(t, conn, budi, "PermDeal", "0812 1000 0012", []int64{svc[0]})
	for _, actor := range []authz.Identity{staffActor("sales-andi"), otherDivisionStaff("ads-tia"), odActor("od-rani")} {
		if _, err := e.closing.SubmitClosing(ctx, conn, actor, pid, soloClosing("sales-budi", sales.PaymentSchemeLunas, nil)); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s close: err = %v, want denied", actor.EmployeeID, err)
		}
	}

	// Layered Staff+OD on the OWN attempt: write from the Staff scope.
	layered := authz.Identity{EmployeeID: "sales-budi", Divisi: sales.DivisiSales, Roles: []authz.Role{authz.RoleStaff, authz.RoleOD}}
	client, err := e.closing.SubmitClosing(ctx, conn, layered, pid, sales.ClosingInput{
		Salespeople: []sales.SalespersonAllocation{
			{EmployeeID: "sales-budi", BasisPoints: 7000},
			{EmployeeID: "sales-sinta", BasisPoints: 3000, IsCommissionPaymentPIC: true},
		},
		ContractStartDate: mustTime(), ContractDurationMonths: 6, PaymentScheme: sales.PaymentSchemeLunas,
	})
	if err != nil {
		t.Fatalf("layered staff+OD close: %v", err)
	}

	// Reads: owner, allocation member (sinta), SPV, OD, Director allowed.
	for _, actor := range []authz.Identity{budi, staffActor("sales-sinta"), spvActor("sales-head-nia"), odActor("od-rani"), directorActor("dir-mea")} {
		if _, err := e.closing.GetClient(ctx, conn, actor, client.ClientID); err != nil {
			t.Errorf("%s read: %v", actor.EmployeeID, err)
		}
	}
	// A Sales Staff not in the allocation, and cross-division staff, denied.
	for _, actor := range []authz.Identity{staffActor("sales-andi"), otherDivisionStaff("ads-tia")} {
		if _, err := e.closing.GetClient(ctx, conn, actor, client.ClientID); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("%s read: err = %v, want denied", actor.EmployeeID, err)
		}
	}
}

func mustTime() time.Time { return time.Date(2026, time.May, 1, 0, 0, 0, 0, time.UTC) }

// TestClosing_PoolCompetitionWin: two staff claim the same [Pool] lead; the
// first to close wins and the competitor auto-closes [Closed - Kalah
// Kompetisi] in the SAME transaction (M1 §6 rule 5 via ResolveWin).
func TestClosing_PoolCompetitionWin(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)

	// Seed an Active campaign stub and import one lead → [Pool].
	if _, err := conn.Exec(
		`INSERT INTO campaign_stub (campaign_id, status, source, owner_employee_id, created_at)
		 VALUES ('CMP-202607-9001', 'Active', ?, 'mkt-lia', ?)`,
		leads.SourceIklan, time.Now().UTC(),
	); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	mkt := authz.Identity{EmployeeID: "mkt-lia", Divisi: "Marketing", Roles: []authz.Role{authz.RoleStaff}}
	report, err := e.leads.ImportLeads(ctx, conn, mkt, "CMP-202607-9001", []leads.ImportRow{
		{LeadName: "Pool Prospect", Phone: "0812 9000 0001"},
	})
	if err != nil {
		t.Fatalf("ImportLeads: %v", err)
	}
	if report.Imported != 1 {
		t.Fatalf("import report = %+v", report)
	}
	leadID := report.Rows[0].LeadID

	budi := staffActor("sales-budi")
	sinta := staffActor("sales-sinta")
	claimBudi, err := e.leads.ClaimPoolLead(ctx, conn, budi, e.attempts, leadID)
	if err != nil {
		t.Fatalf("Budi claim: %v", err)
	}
	claimSinta, err := e.leads.ClaimPoolLead(ctx, conn, sinta, e.attempts, leadID)
	if err != nil {
		t.Fatalf("Sinta claim: %v", err)
	}

	// Both qualify + approve on standard terms.
	e.qualifyAndApprove(t, conn, budi, claimBudi.ProspectID, []int64{svc[0]})
	e.qualifyAndApprove(t, conn, sinta, claimSinta.ProspectID, []int64{svc[1]})

	// Budi closes first → wins.
	if _, err := e.closing.SubmitClosing(ctx, conn, budi, claimBudi.ProspectID, soloClosing("sales-budi", sales.PaymentSchemeLunas, nil)); err != nil {
		t.Fatalf("Budi close: %v", err)
	}

	if got := rawStatus(t, conn, claimBudi.ProspectID); got != string(statemachine.ProspectClosedSuccess) {
		t.Errorf("Budi attempt = %q, want Closed-Success", got)
	}
	if got := rawStatus(t, conn, claimSinta.ProspectID); got != string(statemachine.ProspectClosedKalah) {
		t.Errorf("Sinta attempt = %q, want [Closed - Kalah Kompetisi]", got)
	}
	lead, err := leads.GetLead(ctx, conn, leadID)
	if err != nil {
		t.Fatal(err)
	}
	if lead.WinningAttempt != claimBudi.ProspectID || lead.WinningSalespersonID != "sales-budi" {
		t.Errorf("winner = %q / %q", lead.WinningAttempt, lead.WinningSalespersonID)
	}
}

// TestClosing_SnapshotsImmutable: the birth snapshots (sales_allocations,
// client_services) reject UPDATE/DELETE at the storage layer.
func TestClosing_SnapshotsImmutable(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	e := newClosingEnv()
	svc := seedAlphaServices(t, conn)
	budi := staffActor("sales-budi")
	pid, _ := e.registerAndApprove(t, conn, budi, "Immutable", "0812 1000 0013", []int64{svc[0], svc[1]})
	client, err := e.closing.SubmitClosing(ctx, conn, budi, pid, soloClosing("sales-budi", sales.PaymentSchemeLunas, nil))
	if err != nil {
		t.Fatalf("SubmitClosing: %v", err)
	}

	stmts := []string{
		`UPDATE sales_allocations SET basis_points = 1 WHERE client_id = '` + client.ClientID + `'`,
		`DELETE FROM sales_allocations WHERE client_id = '` + client.ClientID + `'`,
		`UPDATE client_services SET final_price = '1.00' WHERE client_id = '` + client.ClientID + `'`,
		`DELETE FROM client_services WHERE client_id = '` + client.ClientID + `'`,
	}
	for _, stmt := range stmts {
		if _, err := conn.Exec(stmt); err == nil {
			t.Errorf("%s: succeeded, want trigger SIGNAL", stmt)
		}
	}
}
