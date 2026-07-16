package importer

// DB-backed tests for the W1-19 import engine, following the testutil pattern.
// They cover: dry-run classification with DB left untouched; the client apply
// happy path (Termin, partial verify, routing gate, recompute-from-log); the
// [Lunas] contract gate (with and without a contract); the lead dedup paths; the
// Director-only permission gate; and audit provenance / immutability.

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var director = permission.Actor{EmployeeID: "EMP-YOHAN", Role: permission.Role{Director: true}}

func newSvc(t *testing.T) *Service {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	// EMP-BUDI is the sales PIC / sole allocation member used by completeClient;
	// createClientTx now requires every referenced salesperson to exist (FIX 5).
	testutil.InsertEmployee(t, d, "EMP-BUDI", "Budi", "budi@mea", "Sales", "Staff", true)
	return &Service{DB: d, Engine: statemachine.New()}
}

func rp(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := money.Parse(s)
	if err != nil {
		t.Fatalf("money.Parse(%q): %v", s, err)
	}
	return m
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func countRows(t *testing.T, s *Service, table string) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM "+table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func countAudit(t *testing.T, s *Service, entityType, action string) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = ? AND action = ?`, entityType, action).Scan(&n); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	return n
}

// completeClient returns an otherwise-valid Lunas client row for mutation.
func completeClient() ClientRow {
	return ClientRow{
		Toko: "Toko A", NamaPIC: "PIC A", Kota: "Bandung", LinkToko: "https://shopee/a", Kategori: "Fashion",
		GMVBaselineBulanan: money.Money(0), TargetGMV: money.Money(0),
		SalesPIC:            "EMP-BUDI",
		AlokasiSales:        []AllocationRow{{SalespersonID: "EMP-BUDI", BasisPoints: 10000}},
		TanggalClosing:      day(2026, 5, 1),
		Layanan:             []ServiceRow{{Nama: "Jasa Buka Toko", HargaDeal: money.Money(2000000000)}},
		NilaiTransaksiTotal: money.Money(2000000000), // Rp 20.000.000,00
		SkemaPembayaran:     module5_finance.SchemeLunas,
	}
}

// ── DryRun: dirty fixture, DB untouched ──────────────────────────────────────
func TestDryRunDirtyFixtureLeavesDBUntouched(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	leads := []LeadRow{
		{NamaLead: "Alpha", NoTelepon: "0812-1111", Sumber: "form", StatusTerakhir: "diproses"},        // 0 valid
		{NamaLead: "Alpha Dup", NoTelepon: "+62 812 1111", Sumber: "form", StatusTerakhir: "diproses"}, // 1 dup phone
		{NamaLead: "", NoTelepon: "0812-2222", Sumber: "form", StatusTerakhir: "pool"},                 // 2 missing name
	}

	badAlloc := completeClient()
	badAlloc.AlokasiSales = []AllocationRow{{SalespersonID: "EMP-BUDI", BasisPoints: 5000}} // Σ ≠ 100%

	badTermin := completeClient()
	badTermin.SkemaPembayaran = module5_finance.SchemeTermin
	badTermin.NilaiTransaksiTotal = rp(t, "45000000.00")
	badTermin.Layanan = []ServiceRow{{Nama: "X", HargaDeal: rp(t, "45000000.00")}}
	badTermin.JadwalTermin = []TerminRow{
		{Amount: rp(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rp(t, "25000000.00"), DueDate: day(2026, 6, 17)}, // Σ = 40jt ≠ 45jt
	}

	badScheme := completeClient()
	badScheme.SkemaPembayaran = "[Bayar Sebulan Sekali]"

	clients := []ClientRow{badAlloc, badTermin, badScheme}

	rep, err := s.DryRun(ctx, director, leads, clients)
	if err != nil {
		t.Fatalf("DryRun: %v", err)
	}

	if rep.Total != 6 || rep.Valid != 1 || rep.Duplikat != 1 || rep.Error != 4 {
		t.Fatalf("reconciliation = total%d valid%d dup%d err%d, want 6/1/1/4", rep.Total, rep.Valid, rep.Duplikat, rep.Error)
	}
	// Specific messages sourced from the engines.
	if rep.Rows[1].Status != RowDuplikat {
		t.Errorf("lead 1 status = %q, want duplikat", rep.Rows[1].Status)
	}
	if rep.Rows[2].Message != module1_leads.MsgRowIncomplete {
		t.Errorf("lead 2 message = %q, want %q", rep.Rows[2].Message, module1_leads.MsgRowIncomplete)
	}
	// rows[3]=badAlloc, rows[4]=badTermin, rows[5]=badScheme.
	if rep.Rows[3].Message != "[total alokasi sales harus 100%]" {
		t.Errorf("badAlloc message = %q, want alloc message", rep.Rows[3].Message)
	}
	if rep.Rows[4].Message != module5_finance.TerminMismatchMessage {
		t.Errorf("badTermin message = %q, want %q", rep.Rows[4].Message, module5_finance.TerminMismatchMessage)
	}
	if rep.Rows[5].Message != module5_finance.MsgIncomplete {
		t.Errorf("badScheme message = %q, want %q", rep.Rows[5].Message, module5_finance.MsgIncomplete)
	}

	// DB is untouched.
	for _, tbl := range []string{"leads", "prospect_attempts", "clients", "transactions", "installments", "services", "id_sequences", "audit_log"} {
		if n := countRows(t, s, tbl); n != 0 {
			t.Errorf("dry run mutated %s: %d rows, want 0", tbl, n)
		}
	}
}

// ── Apply client: Termin happy path ──────────────────────────────────────────
func TestApplyClientTerminPartial(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	row := completeClient()
	row.SkemaPembayaran = module5_finance.SchemeTermin
	row.NilaiTransaksiTotal = rp(t, "45000000.00")
	row.Layanan = []ServiceRow{{Nama: "Pendampingan", HargaDeal: rp(t, "45000000.00")}}
	row.JadwalTermin = []TerminRow{
		{Amount: rp(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rp(t, "15000000.00"), DueDate: day(2026, 6, 17)},
		{Amount: rp(t, "15000000.00"), DueDate: day(2026, 7, 1)},
	}
	row.PembayaranTerverifikasi = []PaymentRow{{Amount: rp(t, "15000000.00"), Tanggal: day(2026, 6, 3)}}

	rep, err := s.Apply(ctx, director, nil, []ClientRow{row})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if rep.Applied != 1 || rep.Failed != 0 {
		t.Fatalf("reconciliation applied%d failed%d, want 1/0 (rows=%+v)", rep.Applied, rep.Failed, rep.Rows)
	}
	// CLI + TRX + 1 SVC + 3 INST = 6 ids.
	ids := rep.Rows[0].IssuedIDs
	if len(ids) != 6 {
		t.Fatalf("issued ids = %v (%d), want 6", ids, len(ids))
	}
	trxID := ids[1]

	fin := s.finance()
	rec, err := fin.LoadTransaction(ctx, director, trxID)
	if err != nil {
		t.Fatalf("LoadTransaction: %v", err)
	}
	if rec.Status != module5_finance.TrxTerverifikasiSebagian {
		t.Errorf("status = %q, want %q", rec.Status, module5_finance.TrxTerverifikasiSebagian)
	}
	if rec.AmountVerified != rp(t, "15000000.00") {
		t.Errorf("verified = %q, want 15jt", rec.AmountVerified.Format())
	}
	if rec.AmountOutstanding.Format() != "Rp. 30.000.000,00" {
		t.Errorf("outstanding = %q, want Rp. 30.000.000,00", rec.AmountOutstanding.Format())
	}
	if rec.ReleasedToAccountAt == nil {
		t.Error("released_to_account_at not stamped")
	}
	// Fire-once: exactly one release audit; verification log has one row.
	if got := countAudit(t, s, "client", "released_to_account"); got != 1 {
		t.Errorf("released_to_account audit rows = %d, want 1", got)
	}
	if n := countRows(t, s, "payment_verifications"); n != 1 {
		t.Errorf("payment_verifications = %d, want 1", n)
	}

	// total_sales births at 0 (M4-OA-1: outcome field, NOT the deal value).
	var totalSales string
	if err := s.DB.QueryRowContext(ctx, `SELECT total_sales FROM clients WHERE id = ?`, ids[0]).Scan(&totalSales); err != nil {
		t.Fatalf("read total_sales: %v", err)
	}
	if ts := rp(t, totalSales); ts != money.Money(0) {
		t.Errorf("total_sales = %s, want Rp. 0,00 (never seeded from deal value)", ts.Format())
	}

	// Provenance audit rows exist.
	for _, a := range []struct{ et, ac string }{
		{"client", "import:client"}, {"service", "import:service"},
		{"transaction", "import:transaction"}, {"transaction", "import:schedule"},
	} {
		if countAudit(t, s, a.et, a.ac) == 0 {
			t.Errorf("missing provenance audit %s/%s", a.et, a.ac)
		}
	}
}

// ── Apply client: Lunas full — contract gate ─────────────────────────────────
func TestApplyClientLunasContractGate(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	// Without a contract: full-payment plan is rejected BEFORE any write.
	noContract := completeClient()
	noContract.PembayaranTerverifikasi = []PaymentRow{{Amount: rp(t, "20000000.00"), Tanggal: day(2026, 6, 1)}}
	rep, err := s.Apply(ctx, director, nil, []ClientRow{noContract})
	if err != nil {
		t.Fatalf("Apply(no contract): %v", err)
	}
	if rep.Failed != 1 || rep.Rows[0].Message != module5_finance.MsgContractRequired {
		t.Fatalf("no-contract row = %+v, want failed with contract message", rep.Rows[0])
	}
	if n := countRows(t, s, "clients"); n != 0 {
		t.Fatalf("no-contract row landed %d clients, want 0 (rejected before write)", n)
	}

	// With a contract: reaches [Lunas].
	withContract := completeClient()
	withContract.LinkKontrak = "https://drive/contract"
	withContract.PembayaranTerverifikasi = []PaymentRow{{Amount: rp(t, "20000000.00"), Tanggal: day(2026, 6, 1)}}
	rep, err = s.Apply(ctx, director, nil, []ClientRow{withContract})
	if err != nil {
		t.Fatalf("Apply(with contract): %v", err)
	}
	if rep.Applied != 1 {
		t.Fatalf("with-contract applied = %d, want 1 (rows=%+v)", rep.Applied, rep.Rows)
	}
	trxID := rep.Rows[0].IssuedIDs[1]
	rec, err := s.finance().LoadTransaction(ctx, director, trxID)
	if err != nil {
		t.Fatalf("LoadTransaction: %v", err)
	}
	if rec.Status != module5_finance.TrxLunas {
		t.Errorf("status = %q, want %q", rec.Status, module5_finance.TrxLunas)
	}
}

// ── Apply lead: new / active-duplicate / permission ──────────────────────────
func TestApplyLeadDedupAndPermission(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	// Non-Director is rejected.
	staff := permission.Actor{EmployeeID: "EMP-X", Role: permission.Role{Division: "Sales", Level: permission.LevelStaff}}
	if _, err := s.Apply(ctx, staff, []LeadRow{{NamaLead: "A", NoTelepon: "0812-3", Sumber: "form"}}, nil); err != ErrForbidden {
		t.Fatalf("non-director Apply err = %v, want ErrForbidden", err)
	}
	if _, err := s.DryRun(ctx, staff, nil, nil); err != ErrForbidden {
		t.Fatalf("non-director DryRun err = %v, want ErrForbidden", err)
	}

	// New lead lands; a second row on the same phone is blocked by dedup.
	leads := []LeadRow{
		{NamaLead: "Alpha", NoTelepon: "0812-9999", Sumber: "form", StatusTerakhir: "diproses"},
		{NamaLead: "Alpha Dup", NoTelepon: "62 812 9999", Sumber: "form", StatusTerakhir: "diproses"},
	}
	rep, err := s.Apply(ctx, director, leads, nil)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if rep.Applied != 1 || rep.Duplikat != 1 {
		t.Fatalf("reconciliation applied%d dup%d, want 1/1 (rows=%+v)", rep.Applied, rep.Duplikat, rep.Rows)
	}
	if rep.Rows[1].Message != module1_leads.MsgActiveOtherSalesImport {
		t.Errorf("dup message = %q, want %q", rep.Rows[1].Message, module1_leads.MsgActiveOtherSalesImport)
	}
	if n := countRows(t, s, "leads"); n != 1 {
		t.Errorf("leads = %d, want 1 (no duplicate created)", n)
	}
	// Provenance rows for both the created lead and the blocked attempt.
	if countAudit(t, s, "lead", "import:lead") != 1 {
		t.Errorf("import:lead audit rows = %d, want 1", countAudit(t, s, "lead", "import:lead"))
	}
	if countAudit(t, s, "lead", "import:lead_blocked") != 1 {
		t.Errorf("import:lead_blocked audit rows = %d, want 1", countAudit(t, s, "lead", "import:lead_blocked"))
	}
}

// ── Apply lead: reopen a terminal record ─────────────────────────────────────
func TestApplyLeadReopen(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	// A previously rejected lead on this phone.
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-OLD', 'Sini', '0813-0000', '8130000', 'form', 'Sales', '[Rejected]', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	rep, err := s.Apply(ctx, director, []LeadRow{
		{NamaLead: "Sini", NoTelepon: "0813 0000", Sumber: "form", StatusTerakhir: "diproses"},
	}, nil)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if rep.Applied != 1 {
		t.Fatalf("reopen applied = %d, want 1 (rows=%+v)", rep.Applied, rep.Rows)
	}
	// Reopened, not duplicated.
	if n := countRows(t, s, "leads"); n != 1 {
		t.Errorf("leads = %d, want 1 (reopened)", n)
	}
	var status string
	if err := s.DB.QueryRowContext(ctx, `SELECT record_status FROM leads WHERE id = 'LEAD-OLD'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != module1_leads.StatusPool {
		t.Errorf("reopened status = %q, want %q", status, module1_leads.StatusPool)
	}
	if rep.Rows[0].IssuedIDs[0] != "LEAD-OLD" {
		t.Errorf("reopened id = %v, want LEAD-OLD", rep.Rows[0].IssuedIDs)
	}
}

// terminClientWithPayment returns a valid 2-installment Termin row (Σ = 30jt)
// with the first installment already verified — the smallest row that drives the
// full money path (schedule + replay + routing gate).
func terminClientWithPayment(t *testing.T) ClientRow {
	t.Helper()
	row := completeClient()
	row.SkemaPembayaran = module5_finance.SchemeTermin
	row.NilaiTransaksiTotal = rp(t, "30000000.00")
	row.Layanan = []ServiceRow{{Nama: "Pendampingan", HargaDeal: rp(t, "30000000.00")}}
	row.JadwalTermin = []TerminRow{
		{Amount: rp(t, "15000000.00"), DueDate: day(2026, 6, 3)},
		{Amount: rp(t, "15000000.00"), DueDate: day(2026, 6, 17)},
	}
	row.PembayaranTerverifikasi = []PaymentRow{{Amount: rp(t, "15000000.00"), Tanggal: day(2026, 6, 3)}}
	return row
}

// ── FIX 1: Apply is atomic across create + replay ────────────────────────────
// A replay failure AFTER the client/TRX/INST rows are inserted must roll the
// WHOLE row back — nothing lands. validateClientRow deliberately catches every
// realistic business-rule failure before a write, so a genuine post-validation
// replay failure cannot be produced through the public Apply API; we inject one
// at the real code path (landClientTx) with a payment amount that does not match
// its installment, which VerifyInTx rejects only during replay.
func TestApplyClientReplayFailureRollsBackWhole(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	row := terminClientWithPayment(t)
	// Amount != installment amount → VerifyInTx returns ErrInstallmentAmount at
	// replay, AFTER createClientTx has inserted CLI/TRX/INST/SVC.
	row.PembayaranTerverifikasi = []PaymentRow{{Amount: rp(t, "9999999.00"), Tanggal: day(2026, 6, 3)}}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.landClientTx(ctx, tx, director, row, 0); err == nil {
		_ = tx.Rollback()
		t.Fatal("landClientTx: expected replay failure, got nil")
	}
	if err := tx.Rollback(); err != nil { // applyClient's deferred rollback
		t.Fatalf("rollback: %v", err)
	}

	// Full rollback: create AND replay effects gone.
	for _, tbl := range []string{
		"clients", "transactions", "installments", "services",
		"client_sales_allocations", "payment_verifications", "audit_log",
	} {
		if n := countRows(t, s, tbl); n != 0 {
			t.Errorf("after rolled-back replay failure %s = %d, want 0 (nothing lands)", tbl, n)
		}
	}
}

// ── FIX 1: DryRun replays the full money path with zero mutation ─────────────
// White-box proof that landClientTx (used by dryRunClient under a savepoint)
// runs the OFFICIAL replay: inside the transaction the verification row and the
// routing-gate release stamp are visible; after rollback the DB is untouched.
func TestDryRunClientReplaysFullPathThenRollsBack(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	row := terminClientWithPayment(t)

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := s.landClientTx(ctx, tx, director, row, 0)
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("landClientTx: %v", err)
	}
	// Replay ran through the official path: one verification event...
	var vcount int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM payment_verifications WHERE transaction_id = ?`, ids.Transaction).Scan(&vcount); err != nil {
		t.Fatal(err)
	}
	if vcount != 1 {
		t.Errorf("payment_verifications in tx = %d, want 1 (replay ran)", vcount)
	}
	// ...and the routing gate fired (release stamped) inside the same tx.
	var released sql.NullTime
	if err := tx.QueryRowContext(ctx,
		`SELECT released_to_account_at FROM transactions WHERE id = ?`, ids.Transaction).Scan(&released); err != nil {
		t.Fatal(err)
	}
	if !released.Valid {
		t.Error("routing gate did not fire during replay (released_to_account_at NULL)")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	// Zero mutation after rollback.
	for _, tbl := range []string{"clients", "transactions", "installments", "services", "payment_verifications", "id_sequences", "audit_log"} {
		if n := countRows(t, s, tbl); n != 0 {
			t.Errorf("dry-run path mutated %s: %d rows, want 0", tbl, n)
		}
	}

	// End-to-end DryRun of the same row reports RowValid and touches nothing.
	rep, err := s.DryRun(ctx, director, nil, []ClientRow{row})
	if err != nil {
		t.Fatalf("DryRun: %v", err)
	}
	if rep.Valid != 1 || rep.Error != 0 || rep.Rows[0].Status != RowValid {
		t.Fatalf("DryRun reconciliation valid%d err%d status%q, want 1/0/valid", rep.Valid, rep.Error, rep.Rows[0].Status)
	}
	if n := countRows(t, s, "clients"); n != 0 {
		t.Errorf("DryRun mutated clients: %d, want 0", n)
	}
}

// ── FIX 5: employee existence validation ─────────────────────────────────────
func TestApplyClientEmployeeNotRegistered(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	// SalesPIC + allocation name an employee_id that never synced from HRIS.
	row := completeClient()
	row.SalesPIC = "EMP-GHOST"
	row.AlokasiSales = []AllocationRow{{SalespersonID: "EMP-GHOST", BasisPoints: 10000}}

	rep, err := s.Apply(ctx, director, nil, []ClientRow{row})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if rep.Failed != 1 {
		t.Fatalf("failed = %d, want 1 (rows=%+v)", rep.Failed, rep.Rows)
	}
	if want := "[karyawan tidak terdaftar: EMP-GHOST]"; rep.Rows[0].Message != want {
		t.Errorf("message = %q, want %q", rep.Rows[0].Message, want)
	}
	if n := countRows(t, s, "clients"); n != 0 {
		t.Errorf("clients = %d, want 0 (rejected before write)", n)
	}
	// Dry-run reports the same as an error row.
	rep, err = s.DryRun(ctx, director, nil, []ClientRow{row})
	if err != nil {
		t.Fatalf("DryRun: %v", err)
	}
	if rep.Error != 1 || rep.Rows[0].Message != "[karyawan tidak terdaftar: EMP-GHOST]" {
		t.Errorf("dry-run row = %+v, want error with employee message", rep.Rows[0])
	}
}

// ── O19: import dedup shares the official LEFT JOIN match query ─────────────
// A [Rejected] lead whose ONLY attempt is owned by an employee not in
// employees: the shared module1_leads.MatchByPhone LEFT JOINs employees, so
// that attempt is VISIBLE to dedup (owner name falls back to the raw employee
// id) exactly as it is to live Register (O19 RESOLVED 2026-07-16 — the old
// importer mirror's INNER JOIN drop was a defect, not intended behavior). A
// visible open attempt means the import row BLOCKS, it does not reopen.
func TestImportLeadBlocksWhenAttemptOwnerNotEmployee(t *testing.T) {
	s := newSvc(t)
	ctx := context.Background()

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-GHOST', 'Ghosty', '0813-7777', '8137777', 'form', 'Sales', '[Rejected]', 'TEST')`); err != nil {
		t.Fatal(err)
	}
	// Non-terminal attempt owned by EMP-GHOST, deliberately absent from employees.
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
		 VALUES ('PRSP-GHOST', 'LEAD-GHOST', 'EMP-GHOST', 'New Lead', 'TEST')`); err != nil {
		t.Fatal(err)
	}

	row := LeadRow{NamaLead: "Ghosty", NoTelepon: "0813 7777", Sumber: "form", StatusTerakhir: "diproses"}
	wantMsg := "[lead sedang diproses oleh sales lain (EMP-GHOST)]"

	// Dry-run: blocked, not reopened — the not-yet-synced owner is visible.
	rep, err := s.DryRun(ctx, director, []LeadRow{row}, nil)
	if err != nil {
		t.Fatalf("DryRun: %v", err)
	}
	if rep.Rows[0].Status != RowDuplikat {
		t.Fatalf("dry-run status = %q msg %q, want duplikat (attempt visible via LEFT JOIN)",
			rep.Rows[0].Status, rep.Rows[0].Message)
	}
	if rep.Rows[0].Message != wantMsg {
		t.Errorf("dry-run message = %q, want %q", rep.Rows[0].Message, wantMsg)
	}

	// Apply: LEAD-GHOST stays [Rejected] — blocked, nothing changes.
	rep, err = s.Apply(ctx, director, []LeadRow{row}, nil)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if rep.Duplikat != 1 || rep.Applied != 0 {
		t.Fatalf("reconciliation applied%d dup%d, want 0/1 (rows=%+v)", rep.Applied, rep.Duplikat, rep.Rows)
	}
	var status string
	if err := s.DB.QueryRowContext(ctx, `SELECT record_status FROM leads WHERE id = 'LEAD-GHOST'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "[Rejected]" {
		t.Errorf("status = %q, want [Rejected] (blocked, not reopened)", status)
	}
	if countAudit(t, s, "lead", "import:lead_blocked") != 1 {
		t.Errorf("import:lead_blocked audit rows = %d, want 1", countAudit(t, s, "lead", "import:lead_blocked"))
	}
}

// ── FIX 4: scheduled payments must be in non-decreasing date order ───────────
func TestValidateClientRowPaymentOrder(t *testing.T) {
	row := terminClientWithPayment(t)
	// Two verified payments matching the two installments, but out of date order.
	row.PembayaranTerverifikasi = []PaymentRow{
		{Amount: rp(t, "15000000.00"), Tanggal: day(2026, 6, 17)},
		{Amount: rp(t, "15000000.00"), Tanggal: day(2026, 6, 3)},
	}
	// LinkKontrak needed: both termin verified reaches [Lunas].
	row.LinkKontrak = "https://drive/contract"
	if err := validateClientRow(row); err != errPaymentOrder {
		t.Fatalf("validateClientRow = %v, want errPaymentOrder", err)
	}
	// In order: accepted.
	row.PembayaranTerverifikasi = []PaymentRow{
		{Amount: rp(t, "15000000.00"), Tanggal: day(2026, 6, 3)},
		{Amount: rp(t, "15000000.00"), Tanggal: day(2026, 6, 17)},
	}
	if err := validateClientRow(row); err != nil {
		t.Fatalf("validateClientRow (ordered) = %v, want nil", err)
	}
}
