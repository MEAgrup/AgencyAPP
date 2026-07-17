package module1_leads

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func mktActor(id, level string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: MarketingDivision, Level: level}}
}

func dirActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}

func countLeads(t *testing.T, s *Service) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM leads`).Scan(&n); err != nil {
		t.Fatalf("count leads: %v", err)
	}
	return n
}

func countAttempts(t *testing.T, s *Service) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM prospect_attempts`).Scan(&n); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	return n
}

// TestBulkImport_RowLevel is the M1 §3 core AC: valid+unique rows import as
// [Pool] (no attempt, Marketing door); a duplicate of an active scouted lead is
// blocked per-row with the verbatim reason pointing at the existing record; a
// missing-mandatory row is rejected; one bad row never blocks the rest; the
// report reconciles + the §3 Flow-7 summary is byte-exact; rejected rows change
// nothing and the import spawns no attempts.
func TestBulkImport_RowLevel(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-ANDI", "Andi", "andi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)

	// A pre-existing active scouted lead (Andi's) that one row collides with.
	scouted, _, _, err := s.Register(ctx, salesActor("EMP-ANDI"), RegisterInput{
		LeadName: "Unicorn Digital", PhoneNumber: "0813 2222 3333", Source: "Scouting",
	})
	if err != nil {
		t.Fatalf("seed scouted: %v", err)
	}
	leadsBefore := countLeads(t, s)

	report, err := s.BulkImport(ctx, mktActor("EMP-LIA", permission.LevelStaff), "", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001", Source: "Leads - Iklan"},
		{LeadName: "Toko Dua", PhoneNumber: "0812 111 0002", Source: "Leads - Iklan"},
		{LeadName: "Unicorn Digital", PhoneNumber: "+62813-2222-3333", Source: "Leads - Iklan"}, // dup of active scouted
		{LeadName: "Tanpa Telepon", PhoneNumber: "", Source: "Leads - Iklan"},                   // missing mandatory
		{LeadName: "Toko Tiga", PhoneNumber: "0812 111 0003", Source: "Leads - Iklan"},          // must not be blocked by rows 3/4
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}

	if report.Imported != 3 || report.Rejected != 2 {
		t.Fatalf("expected 3 imported / 2 rejected, got %d/%d", report.Imported, report.Rejected)
	}
	if report.Imported+report.Rejected != len(report.Rows) {
		t.Fatalf("report does not reconcile: %d+%d != %d", report.Imported, report.Rejected, len(report.Rows))
	}
	if got := report.Summary(); got != "[3 lead berhasil diimport, 2 ditolak (duplikat/data tidak lengkap)]" {
		t.Fatalf("summary = %q", got)
	}
	// Duplicate row: verbatim active-lead reason, pointing at the existing record.
	if report.Rows[2].Reason != "[lead sedang diproses oleh sales lain (Andi)]" {
		t.Fatalf("duplicate row reason = %q", report.Rows[2].Reason)
	}
	if report.Rows[2].LeadID != scouted.ID {
		t.Fatalf("rejection must point at the existing record, got %q", report.Rows[2].LeadID)
	}
	// Missing-mandatory row: verbatim §3 Flow-4 reason.
	if report.Rows[3].Reason != MsgRowIncomplete {
		t.Fatalf("missing-data row reason = %q", report.Rows[3].Reason)
	}
	if len(report.Rejections()) != 2 {
		t.Fatalf("rejection list must carry the 2 rejected rows, got %d", len(report.Rejections()))
	}

	// Imported rows: [Pool], Marketing origin division, no attempt.
	for _, i := range []int{0, 1, 4} {
		var status, div string
		if err := s.DB.QueryRow(`SELECT record_status, origin_division FROM leads WHERE id = ?`, report.Rows[i].LeadID).
			Scan(&status, &div); err != nil {
			t.Fatalf("row %d load: %v", i, err)
		}
		if status != RecordPool || div != MarketingDivision {
			t.Fatalf("row %d: status=%q div=%q, want [Pool]/Marketing", i, status, div)
		}
	}

	// Rejected rows changed nothing: lead count grew by exactly the imports and
	// the collided scouted record is untouched.
	if n := countLeads(t, s); n != leadsBefore+3 {
		t.Fatalf("expected %d leads, got %d", leadsBefore+3, n)
	}
	var scStatus string
	if err := s.DB.QueryRow(`SELECT record_status FROM leads WHERE id = ?`, scouted.ID).Scan(&scStatus); err != nil {
		t.Fatal(err)
	}
	if scStatus != RecordActive {
		t.Fatalf("collided scouted record mutated: %q", scStatus)
	}
	// M1-OA-6: the blocked import is logged on the existing record...
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: scouted.ID})
	var blocked int
	for _, e := range le {
		if e.Action == "dedup_blocked" {
			blocked++
		}
	}
	if blocked != 1 {
		t.Fatalf("blocked import must be logged once on the existing record, got %d", blocked)
	}
	// ...and the import never spawns an attempt (only Andi's scouted attempt).
	if n := countAttempts(t, s); n != 1 {
		t.Fatalf("import must not spawn attempts, got %d", n)
	}
}

// TestBulkImport_ReopenTerminal: §3 Flow-6 — a duplicate of a Not-Qualified lead
// is allowed back in and reopens the existing record to [Pool] (counted as
// imported, never duplicated), audited.
func TestBulkImport_ReopenTerminal(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-NQ', 'Toko Lama', '0812 555 0001', ?, 'Leads - Iklan', 'Marketing', '[Not Qualified]', 'TEST')`,
		NormalizePhone("0812 555 0001")); err != nil {
		t.Fatal(err)
	}

	report, err := s.BulkImport(ctx, mktActor("EMP-LIA", permission.LevelStaff), "", []BulkRow{
		{LeadName: "Toko Lama", PhoneNumber: "+62812 555 0001", Source: "Leads - Iklan"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	if report.Imported != 1 || !report.Rows[0].Reopened || report.Rows[0].LeadID != "LEAD-NQ" {
		t.Fatalf("expected reopen of LEAD-NQ, got %+v", report.Rows[0])
	}
	var status string
	if err := s.DB.QueryRow(`SELECT record_status FROM leads WHERE id = 'LEAD-NQ'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != RecordPool {
		t.Fatalf("reopened record must be [Pool], got %q", status)
	}
	if n := countLeads(t, s); n != 1 {
		t.Fatalf("reopen must never duplicate, got %d leads", n)
	}
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: "LEAD-NQ"})
	var reopen int
	for _, e := range le {
		if e.Action == "dedup_reopen" {
			reopen++
		}
	}
	if reopen != 1 {
		t.Fatalf("reopen must be audited once, got %d", reopen)
	}
}

// TestBulkImport_PoolDuplicateBlocked: §5 row 2 — a duplicate of a lead already
// in [Pool] (nobody holding an attempt) is blocked as a duplicate record; no
// second record is created and the row points at the existing lead.
func TestBulkImport_PoolDuplicateBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-POOL', 'Toko Pool', '0812 777 0001', ?, 'Leads - Iklan', 'Marketing', '[Pool]', 'TEST')`,
		NormalizePhone("0812 777 0001")); err != nil {
		t.Fatal(err)
	}

	report, err := s.BulkImport(ctx, mktActor("EMP-LIA", permission.LevelStaff), "", []BulkRow{
		{LeadName: "Toko Pool", PhoneNumber: "0812-777-0001", Source: "Leads - Iklan"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	if report.Imported != 0 || report.Rejected != 1 {
		t.Fatalf("pool duplicate must reject the row, got %+v", report)
	}
	if report.Rows[0].Reason != MsgDuplicatePool || report.Rows[0].LeadID != "LEAD-POOL" {
		t.Fatalf("row = %+v, want block MsgDuplicatePool pointing at LEAD-POOL", report.Rows[0])
	}
	if n := countLeads(t, s); n != 1 {
		t.Fatalf("pool duplicate must not create a second record, got %d", n)
	}
}

// TestBulkImport_ClientBlocked: §5 row 4 — a row whose phone already became a
// client is blocked with the verbatim already-client reason.
func TestBulkImport_ClientBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-WON', 'Sudah Klien', '0812 999 0001', ?, 'Leads - Iklan', 'Marketing', '[Closed-Success]', 'TEST')`,
		NormalizePhone("0812 999 0001")); err != nil {
		t.Fatal(err)
	}

	report, err := s.BulkImport(ctx, mktActor("EMP-LIA", permission.LevelStaff), "", []BulkRow{
		{LeadName: "Sudah Klien", PhoneNumber: "0812 999 0001", Source: "Leads - Iklan"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	if report.Rejected != 1 || report.Rows[0].Reason != MsgAlreadyClient {
		t.Fatalf("client dup must block with MsgAlreadyClient, got %+v", report.Rows[0])
	}
}

// TestBulkImport_Permissions pins the M1 §9.1 write gate: Marketing Staff/Lead
// and Director may import; a Sales Staff and a pure-OD account are denied with
// the canonical role-denied message and nothing runs.
func TestBulkImport_Permissions(t *testing.T) {
	s := newService(t)
	ctx := context.Background()

	allowed := []permission.Actor{
		mktActor("EMP-LIA", permission.LevelStaff),
		mktActor("EMP-MHEAD", permission.LevelLead),
		dirActor("EMP-DIR"),
	}
	for _, a := range allowed {
		if _, err := s.BulkImport(ctx, a, "", nil); err != nil {
			t.Fatalf("actor %+v must be allowed, got %v", a.Role, err)
		}
	}

	denied := []permission.Actor{
		salesActor("EMP-SALES"),                                 // Sales staff
		{EmployeeID: "EMP-OD", Role: permission.Role{OD: true}}, // pure OD, read-only
	}
	for _, a := range denied {
		_, err := s.BulkImport(ctx, a, "", []BulkRow{{LeadName: "X", PhoneNumber: "0812", Source: "Leads - Iklan"}})
		var blocked *ErrBlocked
		if !errors.As(err, &blocked) {
			t.Fatalf("actor %+v must be denied *ErrBlocked, got %v", a.Role, err)
		}
	}
	// The denied request created nothing.
	if n := countLeads(t, s); n != 0 {
		t.Fatalf("denied import must create nothing, got %d leads", n)
	}
}

// TestBulkImportReport_SummaryFormat pins the exact PRD §3 example numbers.
func TestBulkImportReport_SummaryFormat(t *testing.T) {
	r := BulkReport{Imported: 46, Rejected: 4}
	if got := r.Summary(); got != "[46 lead berhasil diimport, 4 ditolak (duplikat/data tidak lengkap)]" {
		t.Fatalf("summary = %q", got)
	}
}
