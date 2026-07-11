package module5_finance

// DB-backed tests for the Module 5 persistence surface (W1-14/15/16). Pure money
// math lives in rollup_test.go; this file exercises the schedule/verify/routing
// flows against MySQL: the three PRD worked examples (Alpha/Unicorn/Sini), the
// guards, the rollup rule, scheme change, and recompute-from-log + immutability.

import (
	"context"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// --- actors (constructed in-memory; the service reads actor directly) ---

var (
	financeStaff = permission.Actor{EmployeeID: "EMP-FIN", Role: permission.Role{Division: FinanceDivision, Level: permission.LevelStaff}}
	financeLead  = permission.Actor{EmployeeID: "EMP-FINHEAD", Role: permission.Role{Division: FinanceDivision, Level: permission.LevelLead}}
	salesOwner   = permission.Actor{EmployeeID: "EMP-BUDI", Role: permission.Role{Division: SalesDivision, Level: permission.LevelStaff}}
	salesOther   = permission.Actor{EmployeeID: "EMP-ANDI", Role: permission.Role{Division: SalesDivision, Level: permission.LevelStaff}}
	salesLead    = permission.Actor{EmployeeID: "EMP-DEWI", Role: permission.Role{Division: SalesDivision, Level: permission.LevelLead}}
	accountStaff = permission.Actor{EmployeeID: "EMP-AMEL", Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
	odActor      = permission.Actor{EmployeeID: "EMP-ODI", Role: permission.Role{OD: true}}
	director     = permission.Actor{EmployeeID: "EMP-YOHAN", Role: permission.Role{Director: true}}
)

func newSvc(t *testing.T) *Service {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Engine: statemachine.New()}
}

func seedClient(t *testing.T, s *Service, clientID, salesPIC string) {
	t.Helper()
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '0.00', '0.00', '0.00', ?, ?, 'TEST')`,
		clientID, clientID, salesPIC, salesPIC); err != nil {
		t.Fatal(err)
	}
}

// seedTrx inserts a transaction. contract="" -> NULL.
func seedTrx(t *testing.T, s *Service, trxID, clientID, scheme, total, contract string) {
	t.Helper()
	var c any
	if contract != "" {
		c = contract
	}
	if _, err := s.DB.ExecContext(context.Background(),
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, contract_attachment, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, 'TEST')`,
		trxID, clientID, scheme, total, TrxMenungguVerifikasi, c); err != nil {
		t.Fatal(err)
	}
}

func rpm(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := money.Parse(s)
	if err != nil {
		t.Fatalf("money.Parse(%q): %v", s, err)
	}
	return m
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func mustLoad(t *testing.T, s *Service, actor permission.Actor, id string) TransactionRecord {
	t.Helper()
	rec, err := s.LoadTransaction(context.Background(), actor, id)
	if err != nil {
		t.Fatalf("LoadTransaction(%s): %v", id, err)
	}
	return rec
}

func trxReleasedAt(t *testing.T, s *Service, trxID string) (trx, cli *time.Time) {
	t.Helper()
	var tr, cl *time.Time
	var clientID string
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT released_to_account_at, client_id FROM transactions WHERE id = ?`, trxID).Scan(&tr, &clientID); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT released_to_account_at FROM clients WHERE id = ?`, clientID).Scan(&cl); err != nil {
		t.Fatal(err)
	}
	return tr, cl
}

func countAudit(t *testing.T, s *Service, entityType, entityID, action string) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ?`,
		entityType, entityID, action).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ── Worked example 1: Alpha Digital (Termin, 45jt in 3×15jt) ──────────────────
func TestWorkedAlphaTermin(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-ALPHA", "EMP-BUDI")
	seedTrx(t, s, "TRX-ALPHA", "CLI-ALPHA", SchemeTermin, "45000000.00", "")

	// W1-14: build the schedule via CreateSchedule (Σ = total).
	items := []ScheduleItem{
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 17)},
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 7, 1)},
	}
	created, err := s.CreateSchedule(ctx, salesOwner, "TRX-ALPHA", items)
	if err != nil {
		t.Fatalf("CreateSchedule: %v", err)
	}
	if len(created) != 3 {
		t.Fatalf("created %d installments, want 3", len(created))
	}

	// Verify installment 1 -> partial + routing gate fires.
	rec, err := s.Verify(ctx, financeStaff, "TRX-ALPHA", VerifyRequest{
		InstallmentID: created[0].ID, Amount: rpm(t, "15000000.00"), ReceivedDate: day(2026, 6, 3),
	})
	if err != nil {
		t.Fatalf("verify INST-1: %v", err)
	}
	if rec.Status != TrxTerverifikasiSebagian {
		t.Errorf("status = %q, want %q", rec.Status, TrxTerverifikasiSebagian)
	}
	if rec.Installments[0].Status != InstTerverifikasi {
		t.Errorf("INST-1 status = %q, want %q", rec.Installments[0].Status, InstTerverifikasi)
	}
	if rec.AmountOutstanding.Format() != "Rp. 30.000.000,00" {
		t.Errorf("outstanding = %q, want Rp. 30.000.000,00", rec.AmountOutstanding.Format())
	}
	trxRel, cliRel := trxReleasedAt(t, s, "TRX-ALPHA")
	if trxRel == nil || cliRel == nil {
		t.Fatalf("released_to_account_at not stamped: trx=%v cli=%v", trxRel, cliRel)
	}
	if got := countAudit(t, s, "client", "CLI-ALPHA", "released_to_account"); got != 1 {
		t.Errorf("released_to_account audit rows = %d, want 1", got)
	}
	firstRel := *trxRel

	// Verify installment 2 -> still partial (2/3); routing must NOT re-fire.
	rec, err = s.Verify(ctx, financeStaff, "TRX-ALPHA", VerifyRequest{
		InstallmentID: created[1].ID, Amount: rpm(t, "15000000.00"), ReceivedDate: day(2026, 6, 17),
	})
	if err != nil {
		t.Fatalf("verify INST-2: %v", err)
	}
	if rec.Status != TrxTerverifikasiSebagian {
		t.Errorf("after 2/3 status = %q, want %q", rec.Status, TrxTerverifikasiSebagian)
	}
	trxRel2, _ := trxReleasedAt(t, s, "TRX-ALPHA")
	if !trxRel2.Equal(firstRel) {
		t.Errorf("fire-once violated: released_at changed %v -> %v", firstRel, *trxRel2)
	}
	if got := countAudit(t, s, "client", "CLI-ALPHA", "released_to_account"); got != 1 {
		t.Errorf("released_to_account audit rows after INST-2 = %d, want 1", got)
	}

	// Rollup: [Lunas] only when ALL installments verified — and contract gate
	// blocks the FINAL installment when no contract (M5 §7 Rule 2, installment path).
	_, err = s.Verify(ctx, financeStaff, "TRX-ALPHA", VerifyRequest{
		InstallmentID: created[2].ID, Amount: rpm(t, "15000000.00"), ReceivedDate: day(2026, 7, 1),
	})
	if err != ErrContractRequired {
		t.Fatalf("final installment without contract err = %v, want ErrContractRequired", err)
	}
	// Nothing changed: INST-3 still unverified, TRX still partial.
	rec = mustLoad(t, s, financeStaff, "TRX-ALPHA")
	if rec.Status != TrxTerverifikasiSebagian || rec.Installments[2].Status == InstTerverifikasi {
		t.Fatalf("blocked final verify left changes: status=%q inst3=%q", rec.Status, rec.Installments[2].Status)
	}

	// Attach contract, then the final verify reaches [Lunas].
	if err := s.AttachContract(ctx, financeStaff, "TRX-ALPHA", "https://drive/contract"); err != nil {
		t.Fatalf("AttachContract: %v", err)
	}
	rec, err = s.Verify(ctx, financeStaff, "TRX-ALPHA", VerifyRequest{
		InstallmentID: created[2].ID, Amount: rpm(t, "15000000.00"), ReceivedDate: day(2026, 7, 1),
	})
	if err != nil {
		t.Fatalf("verify INST-3: %v", err)
	}
	if rec.Status != TrxLunas {
		t.Errorf("after 3/3 status = %q, want %q", rec.Status, TrxLunas)
	}
	if rec.AmountOutstanding != 0 {
		t.Errorf("outstanding = %q, want Rp. 0,00", rec.AmountOutstanding.Format())
	}
}

// ── Worked example 2: Unicorn Digital (Bayar Sebagian, 10jt of 30jt) ──────────
func TestWorkedUnicornBayarSebagian(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-UNI", "EMP-BUDI")
	seedTrx(t, s, "TRX-UNI", "CLI-UNI", SchemeBayarSebagian, "30000000.00", "")

	rec, err := s.Verify(ctx, financeStaff, "TRX-UNI", VerifyRequest{
		Amount: rpm(t, "10000000.00"), ReceivedDate: day(2026, 6, 3),
	})
	if err != nil {
		t.Fatalf("direct verify: %v", err)
	}
	if rec.Status != TrxTerverifikasiSebagian {
		t.Errorf("status = %q, want %q", rec.Status, TrxTerverifikasiSebagian)
	}
	if rec.AmountOutstanding.Format() != "Rp. 20.000.000,00" {
		t.Errorf("outstanding = %q, want Rp. 20.000.000,00", rec.AmountOutstanding.Format())
	}
	if len(rec.Installments) != 0 {
		t.Errorf("expected no installments, got %d", len(rec.Installments))
	}
	if trxRel, _ := trxReleasedAt(t, s, "TRX-UNI"); trxRel == nil {
		t.Error("partial payment should release to Account")
	}
}

// ── Worked example 3: Sini Store (Lunas, 20jt) — contract gate ────────────────
func TestWorkedSiniLunasContractGate(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-SINI", "EMP-BUDI")
	seedTrx(t, s, "TRX-SINI", "CLI-SINI", SchemeLunas, "20000000.00", "")

	// Full verification WITHOUT a contract is blocked; nothing changes.
	_, err := s.Verify(ctx, financeStaff, "TRX-SINI", VerifyRequest{
		Amount: rpm(t, "20000000.00"), ReceivedDate: day(2026, 6, 3),
	})
	if err != ErrContractRequired {
		t.Fatalf("lunas without contract err = %v, want ErrContractRequired", err)
	}
	rec := mustLoad(t, s, financeStaff, "TRX-SINI")
	if rec.Status != TrxMenungguVerifikasi {
		t.Errorf("status after blocked verify = %q, want %q", rec.Status, TrxMenungguVerifikasi)
	}
	if rec.AmountVerified != 0 {
		t.Errorf("blocked verify wrote a log: verified = %q", rec.AmountVerified.Format())
	}
	if trxRel, _ := trxReleasedAt(t, s, "TRX-SINI"); trxRel != nil {
		t.Error("blocked verify must not release to Account")
	}

	// Attach contract -> single-jump [Menunggu Verifikasi] -> [Lunas].
	if err := s.AttachContract(ctx, financeStaff, "TRX-SINI", "https://drive/sini"); err != nil {
		t.Fatalf("AttachContract: %v", err)
	}
	rec, err = s.Verify(ctx, financeStaff, "TRX-SINI", VerifyRequest{
		Amount: rpm(t, "20000000.00"), ReceivedDate: day(2026, 6, 3),
	})
	if err != nil {
		t.Fatalf("verify after contract: %v", err)
	}
	if rec.Status != TrxLunas {
		t.Errorf("status = %q, want %q (single jump)", rec.Status, TrxLunas)
	}
	if trxRel, _ := trxReleasedAt(t, s, "TRX-SINI"); trxRel == nil {
		t.Error("full payment should release to Account")
	}
}

// ── Guards ───────────────────────────────────────────────────────────────────
func TestGuards(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-G", "EMP-BUDI")

	// Over-verification: 40jt against a 30jt remainder -> exact message.
	seedTrx(t, s, "TRX-OV", "CLI-G", SchemeBayarSebagian, "30000000.00", "")
	if _, err := s.Verify(ctx, financeStaff, "TRX-OV", VerifyRequest{
		Amount: rpm(t, "40000000.00"), ReceivedDate: day(2026, 6, 3),
	}); err != ErrOverVerified {
		t.Fatalf("over-verify err = %v, want ErrOverVerified", err)
	}

	// Σ termin != total -> exact message.
	seedTrx(t, s, "TRX-MM", "CLI-G", SchemeTermin, "45000000.00", "")
	bad := []ScheduleItem{
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rpm(t, "25000000.00"), DueDate: day(2026, 6, 17)},
	}
	if _, err := s.CreateSchedule(ctx, financeStaff, "TRX-MM", bad); err != ErrTerminMismatch {
		t.Fatalf("mismatch schedule err = %v, want ErrTerminMismatch", err)
	}

	// Double schedule -> rejected.
	seedTrx(t, s, "TRX-DUP", "CLI-G", SchemeTermin, "30000000.00", "")
	good := []ScheduleItem{
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 17)},
	}
	if _, err := s.CreateSchedule(ctx, financeStaff, "TRX-DUP", good); err != nil {
		t.Fatalf("first schedule: %v", err)
	}
	if _, err := s.CreateSchedule(ctx, financeStaff, "TRX-DUP", good); err != ErrScheduleExists {
		t.Fatalf("double schedule err = %v, want ErrScheduleExists", err)
	}

	// Direct verification on a scheduled transaction -> rejected.
	if _, err := s.Verify(ctx, financeStaff, "TRX-DUP", VerifyRequest{
		Amount: rpm(t, "15000000.00"), ReceivedDate: day(2026, 6, 3),
	}); err != ErrDirectOnScheduled {
		t.Fatalf("direct-on-scheduled err = %v, want ErrDirectOnScheduled", err)
	}
}

// ── Recompute-from-log + immutability ────────────────────────────────────────
func TestRecomputeFromLogAndImmutability(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-R", "EMP-BUDI")
	seedTrx(t, s, "TRX-R", "CLI-R", SchemeBayarSebagian, "30000000.00", "")

	if _, err := s.Verify(ctx, financeStaff, "TRX-R", VerifyRequest{Amount: rpm(t, "10000000.00"), ReceivedDate: day(2026, 6, 3)}); err != nil {
		t.Fatalf("verify 1: %v", err)
	}
	if _, err := s.Verify(ctx, financeStaff, "TRX-R", VerifyRequest{Amount: rpm(t, "5000000.00"), ReceivedDate: day(2026, 6, 10)}); err != nil {
		t.Fatalf("verify 2: %v", err)
	}

	// Rebuild Amount Verified straight from the append-only log; compare to the
	// exposed (recomputed) field.
	var sum money.Money
	rows, err := s.DB.QueryContext(ctx, `SELECT amount FROM payment_verifications WHERE transaction_id = ?`, "TRX-R")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			t.Fatal(err)
		}
		sum += rpm(t, a)
		n++
	}
	if n != 2 {
		t.Fatalf("verification log rows = %d, want 2 (append-only, one per event)", n)
	}
	rec := mustLoad(t, s, financeStaff, "TRX-R")
	if rec.AmountVerified != sum {
		t.Errorf("recompute mismatch: log=%s exposed=%s", sum.Format(), rec.AmountVerified.Format())
	}
	if rec.AmountVerified.Format() != "Rp. 15.000.000,00" {
		t.Errorf("verified = %q, want Rp. 15.000.000,00", rec.AmountVerified.Format())
	}
}

// ── Scheme change (M5 §4 Rule 5 / M5-OA-6) ───────────────────────────────────
func TestChangeScheme(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-C", "EMP-BUDI")
	seedTrx(t, s, "TRX-C", "CLI-C", SchemeLunas, "20000000.00", "")

	// No reason -> incomplete.
	if err := s.ChangeScheme(ctx, financeLead, "TRX-C", SchemeTermin, ""); err != ErrIncomplete {
		t.Fatalf("no-reason err = %v, want ErrIncomplete", err)
	}
	// Finance staff (not lead) -> forbidden.
	if err := s.ChangeScheme(ctx, financeStaff, "TRX-C", SchemeTermin, "klien minta cicil"); err != ErrForbidden {
		t.Fatalf("finance staff scheme err = %v, want ErrForbidden", err)
	}
	// Finance lead -> success; audit before->after carries the reason.
	if err := s.ChangeScheme(ctx, financeLead, "TRX-C", SchemeTermin, "klien minta cicil"); err != nil {
		t.Fatalf("finance lead scheme: %v", err)
	}
	var scheme string
	if err := s.DB.QueryRowContext(ctx, `SELECT payment_intent_scheme FROM transactions WHERE id = ?`, "TRX-C").Scan(&scheme); err != nil {
		t.Fatal(err)
	}
	if scheme != SchemeTermin {
		t.Errorf("scheme = %q, want %q", scheme, SchemeTermin)
	}
	if got := countAudit(t, s, "transaction", "TRX-C", "scheme:changed"); got != 1 {
		t.Errorf("scheme:changed audit rows = %d, want 1", got)
	}
	// Original transaction row still present (not deleted).
	var cnt int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM transactions WHERE id = ?`, "TRX-C").Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 1 {
		t.Errorf("transaction row count = %d, want 1 (never deleted)", cnt)
	}
}

// ── Visibility / permission at the service layer ─────────────────────────────
func TestServiceVisibilityAndPermission(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-V", "EMP-BUDI")
	seedTrx(t, s, "TRX-V", "CLI-V", SchemeBayarSebagian, "30000000.00", "")

	// Pre-release: Account cannot see it; owner Sales + Finance + OD + Director can.
	if _, err := s.LoadTransaction(ctx, accountStaff, "TRX-V"); err != ErrNotFound {
		t.Errorf("account pre-release err = %v, want ErrNotFound", err)
	}
	if _, err := s.LoadTransaction(ctx, salesOther, "TRX-V"); err != ErrNotFound {
		t.Errorf("non-owner sales err = %v, want ErrNotFound", err)
	}
	for _, a := range []permission.Actor{salesOwner, salesLead, financeStaff, odActor, director} {
		if _, err := s.LoadTransaction(ctx, a, "TRX-V"); err != nil {
			t.Errorf("actor %s LoadTransaction err = %v, want nil", a.EmployeeID, err)
		}
	}

	// Only Finance/Director may verify; OD (read-only) and Sales cannot.
	if _, err := s.Verify(ctx, odActor, "TRX-V", VerifyRequest{Amount: rpm(t, "1000000.00"), ReceivedDate: day(2026, 6, 3)}); err != ErrForbidden {
		t.Errorf("OD verify err = %v, want ErrForbidden", err)
	}
	if _, err := s.Verify(ctx, salesOwner, "TRX-V", VerifyRequest{Amount: rpm(t, "1000000.00"), ReceivedDate: day(2026, 6, 3)}); err != ErrForbidden {
		t.Errorf("sales verify err = %v, want ErrForbidden", err)
	}

	// After first verification, Account can read it (released).
	if _, err := s.Verify(ctx, financeLead, "TRX-V", VerifyRequest{Amount: rpm(t, "10000000.00"), ReceivedDate: day(2026, 6, 3)}); err != nil {
		t.Fatalf("finance lead verify: %v", err)
	}
	if _, err := s.LoadTransaction(ctx, accountStaff, "TRX-V"); err != nil {
		t.Errorf("account post-release LoadTransaction err = %v, want nil", err)
	}

	// Queue access: Finance/OD/Director yes, Sales/Account no.
	if _, err := s.Queue(ctx, financeStaff); err != nil {
		t.Errorf("finance queue err = %v", err)
	}
	if _, err := s.Queue(ctx, accountStaff); err != ErrForbidden {
		t.Errorf("account queue err = %v, want ErrForbidden", err)
	}
}

// guard: ensure the schedule-created audit summary is written once per schedule.
func TestScheduleAudit(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()
	seedClient(t, s, "CLI-A", "EMP-BUDI")
	seedTrx(t, s, "TRX-A", "CLI-A", SchemeTermin, "30000000.00", "")
	items := []ScheduleItem{
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rpm(t, "15000000.00"), DueDate: day(2026, 6, 17)},
	}
	if _, err := s.CreateSchedule(ctx, financeStaff, "TRX-A", items); err != nil {
		t.Fatalf("CreateSchedule: %v", err)
	}
	if got := countAudit(t, s, "transaction", "TRX-A", "schedule:created"); got != 1 {
		t.Errorf("schedule:created audit rows = %d, want 1 (per transaction, not per row)", got)
	}
	// Sanity: audit read path works.
	if _, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "transaction", EntityID: "TRX-A"}); err != nil {
		t.Fatalf("audit.List: %v", err)
	}
}
