package leads

import (
	"context"
	"strings"
	"testing"
)

// TestAuditHistory_Immutable: house convention #3 — every dedup decision /
// import event / reopen / Last-Touch change appends to the audit log, and that
// history CANNOT be mutated from this package or via raw SQL (the storage
// layer blocks UPDATE/DELETE with SIGNAL 45000 triggers; this test proves the
// triggers hold for the rows Module 1 writes).
func TestAuditHistory_Immutable(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()

	res, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, validSalesForm())
	if err != nil {
		t.Fatal(err)
	}
	recs := auditRows(t, conn, res.Lead.LeadID, actionCreate)
	if len(recs) != 1 {
		t.Fatalf("expected 1 create audit row, got %d", len(recs))
	}

	// No mutation path: raw UPDATE is rejected by the storage layer.
	_, err = conn.Exec(`UPDATE audit_log SET actor = 'penyusup' WHERE id = ?`, recs[0].ID)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected storage-layer UPDATE rejection, got %v", err)
	}
	// No delete path either.
	_, err = conn.Exec(`DELETE FROM audit_log WHERE id = ?`, recs[0].ID)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected storage-layer DELETE rejection, got %v", err)
	}

	// The row is intact afterwards.
	after := auditRows(t, conn, res.Lead.LeadID, actionCreate)
	if len(after) != 1 || after[0].Actor != "EMP-BUDI" {
		t.Fatalf("audit row must be untouched, got %+v", after)
	}
}

// TestAudit_EveryDecisionLogged: M1 §5 rule 6 + §7 — dedup blocks, reopens,
// Last-Touch writes and manual-review flags all leave audit entries with
// actor and before→after where applicable.
func TestAudit_EveryDecisionLogged(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertEmployee(t, conn, "EMP-ANDI", "Andi", "Sales", "Staff")
	insertCampaign(t, conn, "CMP-A", "Active", SourceIklan, "EMP-LIA")
	insertCampaign(t, conn, "CMP-B", "Active", SourceEvent, "EMP-LIA")

	// Import creates -> audited.
	seed, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-A", []ImportRow{
		{LeadName: "Toko Audit", Phone: "0812 900 0001"},
	})
	if err != nil {
		t.Fatal(err)
	}
	leadID := seed.Rows[0].LeadID
	if got := auditRows(t, conn, leadID, actionCreate); len(got) != 1 || got[0].Actor != "EMP-LIA" {
		t.Fatalf("create not audited with actor: %+v", got)
	}

	// Pool duplicate under different campaign -> blocked-dup + last-touch audited.
	if _, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-B", []ImportRow{
		{LeadName: "Toko Audit", Phone: "08129000001"},
	}); err != nil {
		t.Fatal(err)
	}
	if len(auditRows(t, conn, leadID, actionBlockedDup)) != 1 {
		t.Fatal("dedup decision not audited")
	}
	lt := auditRows(t, conn, leadID, actionLastTouch)
	if len(lt) != 1 || lt[0].Before == nil || lt[0].After == nil {
		t.Fatalf("last-touch not audited before→after: %+v", lt)
	}

	// Reopen -> audited with before→after.
	forceRecordStatus(t, conn, leadID, StatusNotQualified)
	if _, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-A", []ImportRow{
		{LeadName: "Toko Audit", Phone: "0812 900 0001"},
	}); err != nil {
		t.Fatal(err)
	}
	ro := auditRows(t, conn, leadID, actionReopen)
	if len(ro) != 1 || ro[0].Before == nil || ro[0].After == nil {
		t.Fatalf("reopen not audited before→after: %+v", ro)
	}

	// Manual-review flag (name differs substantially) -> audited.
	if _, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-A", []ImportRow{
		{LeadName: "Warung Lain Sekali", Phone: "0812 900 0001"},
	}); err != nil {
		t.Fatal(err)
	}
	if len(auditRows(t, conn, leadID, actionManualFlag)) != 1 {
		t.Fatal("manual-review flag not audited")
	}
}
