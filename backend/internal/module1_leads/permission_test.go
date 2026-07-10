package leads

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
)

// TestPermissions_RegisterSalesLead: §9.1 — only Sales (Staff own-data /
// Lead-SPV) and Director may register scouted leads. OD alone is read-only
// everywhere; OD layered on a Sales Staff account keeps the base role's write.
func TestPermissions_RegisterSalesLead(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()

	denied := []struct {
		name  string
		actor authz.Identity
	}{
		{"marketing staff", idMktLia},
		{"marketing lead", idMktLead},
		{"OD only (read-only everywhere)", idODOnly},
		{"unmapped identity", idUnmapped},
	}
	for _, tc := range denied {
		form := validSalesForm()
		if _, err := svc.RegisterSalesLead(ctx, conn, tc.actor, form); !errors.Is(err, authz.ErrDenied) {
			t.Fatalf("%s: expected authz.ErrDenied, got %v", tc.name, err)
		}
	}
	if n := countLeads(t, conn); n != 0 {
		t.Fatalf("denied registrations must create nothing, got %d", n)
	}

	allowed := []struct {
		name  string
		actor authz.Identity
		phone string
	}{
		{"sales staff", idSalesBudi, "0812 200 0001"},
		{"sales lead/SPV", idSalesLead, "0812 200 0002"},
		{"director (full)", idDirector, "0812 200 0003"},
		{"sales staff with layered OD", idSalesStaffOD, "0812 200 0004"},
	}
	for _, tc := range allowed {
		form := validSalesForm()
		form.Phone = tc.phone
		if _, err := svc.RegisterSalesLead(ctx, conn, tc.actor, form); err != nil {
			t.Fatalf("%s: expected success, got %v", tc.name, err)
		}
	}
}

// TestPermissions_ImportLeads: §9.1 — Marketing Staff only under campaigns
// they own; Marketing Lead all campaigns; Sales/OD-only denied; Director full;
// layered OD on a Marketing Staff account keeps the base write.
func TestPermissions_ImportLeads(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-LIA", "Active", SourceIklan, "EMP-LIA")
	insertCampaign(t, conn, "CMP-RINA", "Active", SourceEvent, "EMP-RINA")

	row := func(n string) []ImportRow { return []ImportRow{{LeadName: n, Phone: "0812 3" + n}} }

	// Denied: Marketing Staff on someone ELSE's campaign.
	if _, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-RINA", row("00001")); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("staff on other's campaign: expected denial, got %v", err)
	}
	// Denied: Sales staff, OD-only, unmapped.
	for _, actor := range []authz.Identity{idSalesBudi, idODOnly, idUnmapped} {
		if _, err := svc.ImportLeads(ctx, conn, actor, "CMP-LIA", row("00002")); !errors.Is(err, authz.ErrDenied) {
			t.Fatalf("%s: expected denial, got %v", actor.EmployeeID, err)
		}
	}
	if n := countLeads(t, conn); n != 0 {
		t.Fatalf("denied imports must import nothing, got %d", n)
	}

	// Allowed: own campaign (staff), any campaign (marketing lead), director,
	// layered OD on marketing staff.
	cases := []struct {
		name     string
		actor    authz.Identity
		campaign string
		phone    string
	}{
		{"staff own campaign", idMktLia, "CMP-LIA", "0812 400 0001"},
		{"marketing lead any campaign", idMktLead, "CMP-RINA", "0812 400 0002"},
		{"director", idDirector, "CMP-RINA", "0812 400 0003"},
		{"marketing staff + layered OD", idMktODLayered, "CMP-LIA", "0812 400 0004"},
	}
	for _, tc := range cases {
		report, err := svc.ImportLeads(ctx, conn, tc.actor, tc.campaign, []ImportRow{{LeadName: tc.name, Phone: tc.phone}})
		if err != nil {
			t.Fatalf("%s: expected success, got %v", tc.name, err)
		}
		if report.Imported != 1 {
			t.Fatalf("%s: expected 1 imported, got %+v", tc.name, report)
		}
	}
}

// TestPermissions_Reads: LeadByDashboard / ListByCampaign scoping — Marketing
// Staff own campaigns only; Marketing Lead all; OD read-only everywhere;
// Director full; Sales staff has no Marketing dashboard access.
func TestPermissions_Reads(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-LIA", "Active", SourceIklan, "EMP-LIA")
	if _, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-LIA", []ImportRow{
		{LeadName: "Toko Satu", Phone: "0812 500 0001"},
	}); err != nil {
		t.Fatal(err)
	}
	checker := authz.NewMatrixChecker()

	// Allowed readers.
	for _, actor := range []authz.Identity{idMktLia, idMktLead, idODOnly, idDirector} {
		n, err := LeadByDashboard(ctx, conn, checker, actor, "CMP-LIA")
		if err != nil {
			t.Fatalf("%s: dashboard read denied: %v", actor.EmployeeID, err)
		}
		if n != 1 {
			t.Fatalf("%s: expected count 1, got %d", actor.EmployeeID, n)
		}
		if _, err := ListByCampaign(ctx, conn, checker, actor, "CMP-LIA"); err != nil {
			t.Fatalf("%s: list read denied: %v", actor.EmployeeID, err)
		}
	}
	// Denied readers: another marketing staff (not owner), sales staff, unmapped.
	for _, actor := range []authz.Identity{idMktRina, idSalesBudi, idUnmapped} {
		if _, err := LeadByDashboard(ctx, conn, checker, actor, "CMP-LIA"); !errors.Is(err, authz.ErrDenied) {
			t.Fatalf("%s: expected dashboard denial, got %v", actor.EmployeeID, err)
		}
	}
	// Pool view: any resolved identity reads; unmapped denied.
	if _, err := ListPool(ctx, conn, idSalesBudi, time.Now().UTC()); err != nil {
		t.Fatalf("sales staff must read the pool: %v", err)
	}
	if _, err := ListPool(ctx, conn, idODOnly, time.Now().UTC()); err != nil {
		t.Fatalf("OD must read the pool: %v", err)
	}
	if _, err := ListPool(ctx, conn, idUnmapped, time.Now().UTC()); !errors.Is(err, authz.ErrDenied) {
		t.Fatal("unmapped identity must be denied the pool view")
	}
}

// TestPermissions_MarketingEditLock: M1-OA-5 — Marketing may correct intake
// fields only while the lead has no active Sales attempt; a scouted-active
// lead is read-only for Marketing. OD alone never writes. Every correction is
// audited before→after.
func TestPermissions_MarketingEditLock(t *testing.T) {
	conn, svc, _ := newTestService(t)
	ctx := context.Background()
	insertCampaign(t, conn, "CMP-LIA", "Active", SourceIklan, "EMP-LIA")

	report, err := svc.ImportLeads(ctx, conn, idMktLia, "CMP-LIA", []ImportRow{
		{LeadName: "Toko Satu", Phone: "0812 600 0001"},
	})
	if err != nil {
		t.Fatal(err)
	}
	poolID := report.Rows[0].LeadID
	newName := "Toko Satu Jaya"

	// Allowed: owning Marketing Staff on a [Pool] lead (no active attempt).
	updated, err := svc.EditLeadByMarketing(ctx, conn, idMktLia, poolID, MarketingEditInput{LeadName: &newName})
	if err != nil {
		t.Fatalf("pool lead edit by owning staff: %v", err)
	}
	if updated.LeadName != newName {
		t.Fatalf("edit not applied: %+v", updated)
	}
	recs := auditRows(t, conn, poolID, "correction")
	if len(recs) != 1 || recs[0].Before == nil || recs[0].After == nil {
		t.Fatalf("correction must be audited before→after, got %+v", recs)
	}

	// Denied: other marketing staff (not campaign owner); OD-only; sales staff.
	for _, actor := range []authz.Identity{idMktRina, idODOnly, idSalesBudi} {
		if _, err := svc.EditLeadByMarketing(ctx, conn, actor, poolID, MarketingEditInput{LeadName: &newName}); !errors.Is(err, authz.ErrDenied) {
			t.Fatalf("%s: expected edit denial, got %v", actor.EmployeeID, err)
		}
	}

	// Locked: once the lead has an active Sales attempt, Marketing is
	// read-only (simulated here at record level; the claim path is W1-03).
	scouted, err := svc.RegisterSalesLead(ctx, conn, idSalesBudi, SalesRegistrationForm{
		LeadName: "Milik Sales", Phone: "0812 600 0002", Source: SourceScouting,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EditLeadByMarketing(ctx, conn, idMktLead, scouted.Lead.LeadID, MarketingEditInput{LeadName: &newName}); !errors.Is(err, authz.ErrDenied) {
		t.Fatalf("M1-OA-5: expected read-only lock for marketing, got %v", err)
	}
	// Marketing Lead retains division-wide edit on unlocked leads.
	otherName := "Toko Satu Makmur"
	if _, err := svc.EditLeadByMarketing(ctx, conn, idMktLead, poolID, MarketingEditInput{LeadName: &otherName}); err != nil {
		t.Fatalf("marketing lead division-wide edit: %v", err)
	}
	// Director bypasses the division guard but NOT the M1-OA-5 lock scope: the
	// lock is about Marketing edits; Director full view is preserved elsewhere.
	if _, err := svc.EditLeadByMarketing(ctx, conn, idDirector, poolID, MarketingEditInput{Email: strPtr("dir@x.id")}); err != nil {
		t.Fatalf("director edit on pool lead: %v", err)
	}
}

func strPtr(s string) *string { return &s }
