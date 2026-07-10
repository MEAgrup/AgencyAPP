package leads

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
)

var leadIDPattern = regexp.MustCompile(`^LEAD-\d{6}-\d{4,}$`)

// TestRegisterSalesLead_ValidationBeforeID: mandatory-field failure returns
// the byte-exact Phase 0 default message and creates NOTHING — no LEAD id is
// ever issued before validation passes (house convention #1).
func TestRegisterSalesLead_ValidationBeforeID(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()

	bad := []SalesRegistrationForm{
		{Phone: "0812", Source: SourceScouting},                  // no name
		{LeadName: "X", Source: SourceScouting},                  // no phone
		{LeadName: "X", Phone: "0812"},                           // no source
		{LeadName: "X", Phone: "0812", Source: "Sumber Palsu"},   // outside the reference list
		{LeadName: "X", Phone: "0812", Source: SourceIklan},      // Iklan without Origin Campaign (M1-OA-3)
		{LeadName: "X", Phone: "0812", Source: SourceBroadcast},  // Broadcast without campaign
		{LeadName: "X", Phone: "+62 - ", Source: SourceScouting}, // phone normalises to empty
	}
	for i, form := range bad {
		_, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, form)
		var verr *ValidationError
		if !errors.As(err, &verr) {
			t.Fatalf("case %d: expected ValidationError, got %v", i, err)
		}
		if verr.Message != "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" {
			t.Fatalf("case %d: wrong message %q", i, verr.Message)
		}
	}
	if n := countLeads(t, conn); n != 0 {
		t.Fatalf("expected zero leads after failed validation, got %d", n)
	}
	if len(attempts.all()) != 0 {
		t.Fatal("no attempt may be spawned on failed validation")
	}
	// No id consumed: the very first success must still get sequence 0001.
	res, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, validSalesForm())
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if !strings.HasSuffix(res.Lead.LeadID, "-0001") {
		t.Fatalf("failed validations must not consume ids; first lead got %s", res.Lead.LeadID)
	}
}

// TestRegisterSalesLead_Success: valid form creates the LEAD (Origin Division
// = Sales, exclusive scouted) and spawns the PRSP attempt through the
// injected AttemptCreator inside the same transaction.
func TestRegisterSalesLead_Success(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()

	res, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, validSalesForm())
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if !leadIDPattern.MatchString(res.Lead.LeadID) {
		t.Fatalf("lead id %q does not match LEAD-YYYYMM-NNNN", res.Lead.LeadID)
	}
	if res.ProspectID == "" {
		t.Fatal("expected a PRSP id from the attempt creator")
	}
	got, err := GetLead(ctx, conn, res.Lead.LeadID)
	if err != nil {
		t.Fatal(err)
	}
	if got.OriginDivision != DivisiSales || got.RecordStatus != StatusScoutedActive ||
		got.ScoutedOwnerEmployeeID != "EMP-BUDI" {
		t.Fatalf("unexpected lead: %+v", got)
	}
	if got.PhoneNormalized != "81211112222" {
		t.Fatalf("phone not normalized: %q", got.PhoneNormalized)
	}
	calls := attempts.all()
	if len(calls) != 1 || calls[0].LeadID != res.Lead.LeadID || calls[0].OwnerEmployeeID != "EMP-BUDI" {
		t.Fatalf("attempt not spawned correctly: %+v", calls)
	}
	if len(auditRows(t, conn, res.Lead.LeadID, actionCreate)) != 1 {
		t.Fatal("expected exactly one 'create' audit row")
	}
}

// TestRegisterSalesLead_ScoutedCollision: registering a phone owned by another
// salesperson's ACTIVE scouted lead blocks with the M0 §3 door message
// carrying the real owner name; nothing new is created; the dedup decision is
// audited on the existing record (M1 §5 rule 6).
func TestRegisterSalesLead_ScoutedCollision(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()
	insertEmployee(t, conn, "EMP-ANDI", "Andi", "Sales", "Staff")

	first, err := svc.RegisterSalesLead(ctx, conn, idSalesAndi, SalesRegistrationForm{
		LeadName: "Unicorn Digital", Phone: "0813 2222 3333", Source: SourceScouting,
	})
	if err != nil {
		t.Fatalf("first registration: %v", err)
	}

	_, err = svc.RegisterSalesLead(ctx, conn, idSalesBudi, SalesRegistrationForm{
		LeadName: "Unicorn Digital", Phone: "+62 813-2222-3333", Source: SourceScouting,
	})
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected BlockedError, got %v", err)
	}
	if blocked.Message != "[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (Andi)]" {
		t.Fatalf("wrong block message: %q", blocked.Message)
	}
	if blocked.Outcome != OutcomeBlockScouted || blocked.ExistingLeadID != first.Lead.LeadID {
		t.Fatalf("unexpected block: %+v", blocked)
	}
	if n := countLeads(t, conn); n != 1 {
		t.Fatalf("collision must never create a second record, got %d leads", n)
	}
	if len(attempts.all()) != 1 {
		t.Fatal("no attempt may be spawned for the blocked registrant")
	}
	if len(auditRows(t, conn, first.Lead.LeadID, actionBlockedDup)) != 1 {
		t.Fatal("dedup decision must be written to the existing lead's audit log")
	}
}

// TestRegisterSalesLead_Reopen: a Rejected / Not Qualified record re-entering
// through the Sales door reopens the EXISTING record (never a duplicate),
// spawns a fresh attempt for the re-registrant, and keeps full history.
func TestRegisterSalesLead_Reopen(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()

	first, err := svc.RegisterSalesLead(ctx, conn, idSalesAndi, SalesRegistrationForm{
		LeadName: "Sini Store", Phone: "0815 444 555", Source: SourceScouting,
	})
	if err != nil {
		t.Fatal(err)
	}
	forceRecordStatus(t, conn, first.Lead.LeadID, StatusNotQualified)

	res, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, SalesRegistrationForm{
		LeadName: "Sini Store", Phone: "+62815444555", Source: SourceScouting,
	})
	if err != nil {
		t.Fatalf("reopen registration: %v", err)
	}
	if !res.Reopened || res.Lead.LeadID != first.Lead.LeadID {
		t.Fatalf("expected reopen of %s, got %+v", first.Lead.LeadID, res)
	}
	got, err := GetLead(ctx, conn, first.Lead.LeadID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RecordStatus != StatusPool {
		t.Fatalf("reopened record must be [Pool], got %q", got.RecordStatus)
	}
	if got.PoolEnteredAt.IsZero() {
		t.Fatal("reopen must stamp pool_entered_at (M1-OA-7 stale basis)")
	}
	if n := countLeads(t, conn); n != 1 {
		t.Fatalf("reopen must never duplicate the record, got %d leads", n)
	}
	calls := attempts.all()
	if len(calls) != 2 || calls[1].OwnerEmployeeID != "EMP-BUDI" {
		t.Fatalf("expected a fresh attempt for the re-registrant, got %+v", calls)
	}
	// Full history: create + reopen rows both present, in order.
	if len(auditRows(t, conn, first.Lead.LeadID, actionCreate)) != 1 ||
		len(auditRows(t, conn, first.Lead.LeadID, actionReopen)) != 1 {
		t.Fatal("history must retain both the create and the reopen")
	}
}

// TestRegisterSalesLead_ClientBlocked: §5 row 4 — a record that already became
// a client blocks intake with the byte-exact message.
func TestRegisterSalesLead_ClientBlocked(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()

	first, err := svc.RegisterSalesLead(ctx, conn, idSalesAndi, SalesRegistrationForm{
		LeadName: "ABC Media", Phone: "0817 000 111", Source: SourceScouting,
	})
	if err != nil {
		t.Fatal(err)
	}
	forceRecordStatus(t, conn, first.Lead.LeadID, StatusClient)

	_, err = svc.RegisterSalesLead(ctx, conn, idSalesBudi, SalesRegistrationForm{
		LeadName: "ABC Media", Phone: "0817000111", Source: SourceScouting,
	})
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected BlockedError, got %v", err)
	}
	if blocked.Message != "[lead sudah menjadi klien]" {
		t.Fatalf("wrong message: %q", blocked.Message)
	}
}

// TestRegisterSalesLead_ManualReviewFlag: M1-OA-4 — phone matches but the Lead
// Name differs substantially: same record (never a merge/second record), but a
// manual-review flag is raised and audited.
func TestRegisterSalesLead_ManualReviewFlag(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertEmployee(t, conn, "EMP-ANDI", "Andi", "Sales", "Staff")

	first, err := svc.RegisterSalesLead(ctx, conn, idSalesAndi, SalesRegistrationForm{
		LeadName: "Sini Store", Phone: "0819 888 777", Source: SourceScouting,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.RegisterSalesLead(ctx, conn, idSalesBudi, SalesRegistrationForm{
		LeadName: "Warung Budi", Phone: "0819888777", Source: SourceScouting,
	})
	if err == nil {
		t.Fatal("expected block (active scouted)")
	}
	got, err := GetLead(ctx, conn, first.Lead.LeadID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ManualReviewFlag {
		t.Fatal("manual-review flag must be raised on substantially different name (M1-OA-4)")
	}
	if len(auditRows(t, conn, first.Lead.LeadID, actionManualFlag)) != 1 {
		t.Fatal("manual-review flag must be audited")
	}
	// Same phone, contained name ("PT Sini Store") must NOT flag a fresh record.
	if got.LeadName != "Sini Store" {
		t.Fatalf("existing record name must be untouched, got %q", got.LeadName)
	}
}

// TestRegisterSalesLead_AttemptFailureRollsBack: the LEAD insert and the PRSP
// spawn are one transaction — if the attempt creator fails, no lead row (and
// no audit row) survives.
func TestRegisterSalesLead_AttemptFailureRollsBack(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()

	attempts.failNext = true
	_, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, validSalesForm())
	if err == nil {
		t.Fatal("expected forced failure to surface")
	}
	if n := countLeads(t, conn); n != 0 {
		t.Fatalf("rolled-back registration must leave no lead, got %d", n)
	}
	var auditCount int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'lead'`).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 0 {
		t.Fatalf("rolled-back registration must leave no audit rows, got %d", auditCount)
	}
}

// TestRegisterSalesLead_PoolDuplicatePointsAtExisting: §5 row 2 via the Sales
// door — a [Pool] match blocks record creation and points at the existing
// LEAD (the correct path is a §6 claim, W1-03); Last-Touch is written when the
// intake carries a different campaign.
func TestRegisterSalesLead_PoolDuplicatePointsAtExisting(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-202603-0007", "Active", SourceIklan, "EMP-LIA")

	report, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202603-0007", []ImportRow{
		{LeadName: "Toko Pool", Phone: "0812 999 000"},
	})
	if err != nil || report.Imported != 1 {
		t.Fatalf("seed import failed: %v %+v", err, report)
	}
	poolID := report.Rows[0].LeadID

	_, err = svc.RegisterSalesLead(ctx, conn, idSalesBudi, SalesRegistrationForm{
		LeadName: "Toko Pool", Phone: "0812999000", Source: SourceIklan, OriginCampaign: "CMP-202604-0021",
	})
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected BlockedError, got %v", err)
	}
	if blocked.Outcome != OutcomeBlockPool || blocked.ExistingLeadID != poolID {
		t.Fatalf("unexpected block: %+v", blocked)
	}
	if len(attempts.all()) != 0 {
		t.Fatal("pool duplicate via registration door must not auto-claim")
	}
	got, err := GetLead(ctx, conn, poolID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastTouchCampaign != "CMP-202604-0021" {
		t.Fatalf("expected Last-Touch write, got %q", got.LastTouchCampaign)
	}
	if got.OriginCampaign != "CMP-202603-0007" {
		t.Fatalf("Origin Campaign must NEVER be overwritten, got %q", got.OriginCampaign)
	}
	if len(auditRows(t, conn, poolID, actionLastTouch)) != 1 {
		t.Fatal("Last-Touch change must be audited")
	}
}
