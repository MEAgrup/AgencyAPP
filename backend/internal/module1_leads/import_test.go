package leads

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// TestImportLeads_CampaignGate: W1-02 — import is gated on the parent Campaign
// being Active (stub until M3); a missing or non-Active campaign refuses the
// whole import with the byte-exact BI message and imports nothing.
func TestImportLeads_CampaignGate(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-202607-0002", "Draft", SourceIklan, "EMP-LIA")

	rows := []ImportRow{{LeadName: "A", Phone: "0812000001"}}

	for _, campaignID := range []string{"CMP-202607-0002", "CMP-TIDAK-ADA"} {
		_, err := svc.ImportLeads(ctx, conn, idMktLia, campaignID, rows)
		var verr *ValidationError
		if !errors.As(err, &verr) {
			t.Fatalf("campaign %s: expected ValidationError, got %v", campaignID, err)
		}
		if verr.Message != "[campaign belum/tidak aktif, lead tidak bisa diimport]" {
			t.Fatalf("wrong gate message: %q", verr.Message)
		}
	}
	if n := countLeads(t, conn); n != 0 {
		t.Fatalf("gated import must import nothing, got %d leads", n)
	}
}

// TestImportLeads_RowLevel is the W1-02 core AC: valid+unique rows import as
// [Pool] with Campaign link + auto Source; bad rows reject per-row with the
// byte-exact reason; one bad row never blocks the rest; the report reconciles
// totals; rejected rows change nothing.
func TestImportLeads_RowLevel(t *testing.T) {
	conn, svc, attempts := newTestService(t)
	ctx := context.Background()
	insertEmployee(t, conn, "EMP-ANDI", "Andi", "Sales", "Staff")
	insertCampaign(t, conn, "CMP-202603-0007", "Active", SourceIklan, "EMP-LIA")

	// Pre-existing active scouted lead (Andi's) that one row will collide with.
	scouted, err := svc.RegisterSalesLead(ctx, conn, idSalesAndi, SalesRegistrationForm{
		LeadName: "Unicorn Digital", Phone: "0813 2222 3333", Source: SourceScouting,
	})
	if err != nil {
		t.Fatal(err)
	}
	leadsBefore := countLeads(t, conn)

	report, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202603-0007", []ImportRow{
		{LeadName: "Toko Satu", Phone: "0812 111 0001"},          // valid
		{LeadName: "Toko Dua", Phone: "0812 111 0002"},           // valid
		{LeadName: "Unicorn Digital", Phone: "+62813-2222-3333"}, // duplicate of active scouted
		{LeadName: "Tanpa Telepon", Phone: ""},                   // missing mandatory
		{LeadName: "Toko Tiga", Phone: "0812 111 0003"},          // valid — must not be blocked by row 3/4
	})
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if report.Imported != 3 || report.Rejected != 2 {
		t.Fatalf("expected 3 imported / 2 rejected, got %d/%d", report.Imported, report.Rejected)
	}
	// Report reconciles totals (AC).
	if report.Imported+report.Rejected != len(report.Rows) {
		t.Fatalf("report does not reconcile: %d+%d != %d", report.Imported, report.Rejected, len(report.Rows))
	}
	// Byte-exact §3 Flow step 7 summary.
	if got := report.Summary(); got != "[3 lead berhasil diimport, 2 ditolak (duplikat/data tidak lengkap)]" {
		t.Fatalf("wrong summary: %q", got)
	}
	// Per-row byte-exact reasons.
	if report.Rows[2].Reason != "[lead sudah ada & sedang diproses, tidak diimport]" {
		t.Fatalf("duplicate row reason: %q", report.Rows[2].Reason)
	}
	if report.Rows[2].LeadID != scouted.Lead.LeadID {
		t.Fatal("rejection must point at the existing record")
	}
	if report.Rows[3].Reason != "[data tidak lengkap, baris tidak diimport]" {
		t.Fatalf("missing-data row reason: %q", report.Rows[3].Reason)
	}
	if len(report.Rejections()) != 2 {
		t.Fatalf("rejection list must carry the 2 rejected rows")
	}

	// Imported rows: [Pool], campaign linked, Source auto-derived (M1-OA-3).
	for _, i := range []int{0, 1, 4} {
		got, err := GetLead(ctx, conn, report.Rows[i].LeadID)
		if err != nil {
			t.Fatal(err)
		}
		if got.RecordStatus != StatusPool || got.OriginCampaign != "CMP-202603-0007" ||
			got.Source != SourceIklan || got.OriginDivision != DivisiMarketing {
			t.Fatalf("row %d: unexpected lead %+v", i, got)
		}
		if got.PoolEnteredAt.IsZero() {
			t.Fatalf("row %d: pool_entered_at must be stamped", i)
		}
	}

	// Rejected rows changed nothing: lead count grew by exactly the imports,
	// and the collided scouted record is untouched.
	if n := countLeads(t, conn); n != leadsBefore+3 {
		t.Fatalf("expected %d leads, got %d", leadsBefore+3, n)
	}
	gotScouted, err := GetLead(ctx, conn, scouted.Lead.LeadID)
	if err != nil {
		t.Fatal(err)
	}
	if gotScouted.RecordStatus != StatusScoutedActive || gotScouted.ScoutedOwnerEmployeeID != "EMP-ANDI" {
		t.Fatalf("rejected duplicate must not mutate the existing record: %+v", gotScouted)
	}
	// M1-OA-6: the attribution attempt IS logged on the existing record...
	if len(auditRows(t, conn, scouted.Lead.LeadID, actionBlockedDup)) != 1 {
		t.Fatal("duplicate import must be logged on the existing record")
	}
	// ...but never counted: Lead-by-Dashboard counts only real records.
	n, err := LeadByDashboard(ctx, conn, svc.checker, idMktLia, "CMP-202603-0007")
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("Lead-by-Dashboard must count 3 (blocked duplicates excluded), got %d", n)
	}
	// Marketing import never spawns attempts ([Pool], 0 attempts).
	if len(attempts.all()) != 1 { // only Andi's scouted registration
		t.Fatalf("import must not spawn attempts, got %+v", attempts.all())
	}
}

// TestImportLeads_ReopenRejected: §3 Flow step 6 — a duplicate of a
// Rejected/Not Qualified lead is allowed back in and reopens the existing
// record to [Pool] (counted as imported, never duplicated).
func TestImportLeads_ReopenRejected(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-202603-0007", "Active", SourceIklan, "EMP-LIA")

	seed, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202603-0007", []ImportRow{
		{LeadName: "Toko Lama", Phone: "0812 555 0001"},
	})
	if err != nil {
		t.Fatal(err)
	}
	leadID := seed.Rows[0].LeadID
	forceRecordStatus(t, conn, leadID, StatusRejected)

	report, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202603-0007", []ImportRow{
		{LeadName: "Toko Lama", Phone: "+62812 555 0001"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Imported != 1 || !report.Rows[0].Reopened || report.Rows[0].LeadID != leadID {
		t.Fatalf("expected reopen of %s, got %+v", leadID, report.Rows[0])
	}
	got, err := GetLead(ctx, conn, leadID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RecordStatus != StatusPool {
		t.Fatalf("reopened record must be [Pool], got %q", got.RecordStatus)
	}
	if n := countLeads(t, conn); n != 1 {
		t.Fatalf("reopen must never duplicate, got %d leads", n)
	}
	if len(auditRows(t, conn, leadID, actionReopen)) != 1 {
		t.Fatal("reopen must be audited")
	}
}

// TestImportLeads_PoolDuplicateLastTouch: §5 Last-Touch — a pool duplicate
// under a DIFFERENT campaign is rejected (no second record) but the newer
// campaign is written to Last-Touch Campaign, never overwriting Origin.
func TestImportLeads_PoolDuplicateLastTouch(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-202603-0007", "Active", SourceIklan, "EMP-LIA")
	insertCampaign(t, conn, "CMP-202604-0011", "Active", SourceEvent, "EMP-LIA")

	seed, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202603-0007", []ImportRow{
		{LeadName: "Toko Pool", Phone: "0812 777 0001"},
	})
	if err != nil {
		t.Fatal(err)
	}
	leadID := seed.Rows[0].LeadID

	report, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202604-0011", []ImportRow{
		{LeadName: "Toko Pool", Phone: "0812-777-0001"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Imported != 0 || report.Rejected != 1 {
		t.Fatalf("pool duplicate must reject the row, got %+v", report)
	}
	got, err := GetLead(ctx, conn, leadID)
	if err != nil {
		t.Fatal(err)
	}
	if got.OriginCampaign != "CMP-202603-0007" {
		t.Fatalf("Origin Campaign must stay the immutable first touch, got %q", got.OriginCampaign)
	}
	if got.LastTouchCampaign != "CMP-202604-0011" {
		t.Fatalf("Last-Touch Campaign must record the newer touch, got %q", got.LastTouchCampaign)
	}
	if len(auditRows(t, conn, leadID, actionLastTouch)) != 1 {
		t.Fatal("Last-Touch change must be audited")
	}

	// Re-import under the SAME campaign: no new Last-Touch write.
	if _, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202604-0011", []ImportRow{
		{LeadName: "Toko Pool", Phone: "08127770001"},
	}); err != nil {
		t.Fatal(err)
	}
	if len(auditRows(t, conn, leadID, actionLastTouch)) != 1 {
		t.Fatal("same-campaign duplicate must not rewrite Last-Touch")
	}
}

// TestImportReport_SummaryFormat pins the exact PRD example numbers (M1 §3):
// 46 imported, 4 rejected.
func TestImportReport_SummaryFormat(t *testing.T) {
	r := ImportReport{Imported: 46, Rejected: 4}
	if got := r.Summary(); got != "[46 lead berhasil diimport, 4 ditolak (duplikat/data tidak lengkap)]" {
		t.Fatalf("summary: %q", got)
	}
}

// TestParseCSV covers the v1 CSV parser: header aliases, optional email,
// ragged rows becoming per-row rejections, and missing mandatory columns.
func TestParseCSV(t *testing.T) {
	rows, err := ParseCSV(strings.NewReader(
		"Lead Name,Phone Number,Email\n" +
			"Toko Satu,0812 111 0001,satu@x.id\n" +
			"Toko Dua,08121110002,\n" +
			",0812 111 0003,x@x.id\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}
	if rows[0].LeadName != "Toko Satu" || rows[0].Phone != "0812 111 0001" || rows[0].Email != "satu@x.id" {
		t.Fatalf("row 0: %+v", rows[0])
	}
	if rows[2].LeadName != "" { // stays empty -> rejected later at row level
		t.Fatalf("row 2: %+v", rows[2])
	}

	// Missing phone column entirely: nothing importable.
	if _, err := ParseCSV(strings.NewReader("Lead Name,Email\nA,b@x.id\n")); err == nil {
		t.Fatal("expected error for missing mandatory column")
	}
}

// TestListPool_StaleComputed: M1-OA-7 — a [Pool] lead older than 24h is
// flagged stale (computed, never stored), stays claimable ([Pool]), and is
// never removed. Fresh pool leads are not stale.
func TestListPool_StaleComputed(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-202603-0007", "Active", SourceIklan, "EMP-LIA")

	report, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-202603-0007", []ImportRow{
		{LeadName: "Segar", Phone: "0812 123 0001"},
		{LeadName: "Basi", Phone: "0812 123 0002"},
	})
	if err != nil {
		t.Fatal(err)
	}
	staleID := report.Rows[1].LeadID
	// Age the second lead's pool entry past the TTL.
	if _, err := conn.Exec(`UPDATE leads SET pool_entered_at = ? WHERE lead_id = ?`,
		time.Now().UTC().Add(-25*time.Hour), staleID); err != nil {
		t.Fatal(err)
	}

	pool, err := ListPool(ctx, conn, idSalesBudi, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(pool) != 2 {
		t.Fatalf("stale leads must STAY in the pool (claimable), got %d", len(pool))
	}
	byID := map[string]PoolLead{}
	for _, p := range pool {
		byID[p.LeadID] = p
	}
	if !byID[staleID].Stale {
		t.Fatal("25h-old pool lead must be flagged stale")
	}
	if byID[report.Rows[0].LeadID].Stale {
		t.Fatal("fresh pool lead must not be stale")
	}
	if byID[staleID].RecordStatus != StatusPool {
		t.Fatal("stale flag must not change record status")
	}
}
