package module1_leads

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// insertCampaign seeds a campaigns row (Cluster-1 table) with a given channel +
// status, so the Cluster-2 linkage can be tested without wiring module3.
func insertCampaign(t *testing.T, s *Service, id, channel, status string) {
	t.Helper()
	if _, err := s.DB.Exec(
		`INSERT INTO campaigns (id, name, channel, is_online, is_offline, start_date, owner_employee_id, status, created_by)
		 VALUES (?, ?, ?, 1, 0, '2026-03-01', 'EMP-LIA', ?, 'EMP-LIA')`,
		id, "Camp "+id, channel, status); err != nil {
		t.Fatalf("insert campaign %s: %v", id, err)
	}
}

func campaignStatus(t *testing.T, s *Service, id string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRow(`SELECT status FROM campaigns WHERE id = ?`, id).Scan(&st); err != nil {
		t.Fatalf("read campaign status: %v", err)
	}
	return st
}

func leadCampaigns(t *testing.T, s *Service, leadID string) (origin, lastTouch string) {
	t.Helper()
	var o, l sql.NullString
	if err := s.DB.QueryRow(`SELECT origin_campaign_id, last_touch_campaign_id FROM leads WHERE id = ?`, leadID).Scan(&o, &l); err != nil {
		t.Fatalf("read lead campaigns: %v", err)
	}
	return o.String, l.String
}

func leadSource(t *testing.T, s *Service, leadID string) string {
	t.Helper()
	var src string
	if err := s.DB.QueryRow(`SELECT source FROM leads WHERE id = ?`, leadID).Scan(&src); err != nil {
		t.Fatalf("read lead source: %v", err)
	}
	return src
}

func mkt(id string) permission.Actor { return mktActor(id, permission.LevelStaff) }

// TestBulkImport_Campaign_SourceOriginLastTouch: a campaign-scoped import derives
// Source from the Channel (mapped: TikTok Ads -> Leads - Iklan), sets origin AND
// last-touch to the campaign, and — for an unmapped channel — falls back to the
// Channel string as-is (M3 §2 / M1-OA-3 / M3-OA-2).
func TestBulkImport_Campaign_SourceOriginLastTouch(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
	insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", "Active")
	insertCampaign(t, s, "CMP-202603-0008", "Webinar Spesial", "Active") // unmapped channel

	// Mapped channel: rows may omit Source (campaign supplies it).
	rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202603-0007", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	if rep.Imported != 1 {
		t.Fatalf("imported = %d, want 1", rep.Imported)
	}
	lead := rep.Rows[0].LeadID
	if got := leadSource(t, s, lead); got != "Leads - Iklan" {
		t.Errorf("mapped source = %q, want Leads - Iklan", got)
	}
	if o, l := leadCampaigns(t, s, lead); o != "CMP-202603-0007" || l != "CMP-202603-0007" {
		t.Errorf("origin/last-touch = %q/%q, want both CMP-202603-0007", o, l)
	}

	// Unmapped channel: Source falls back to the Channel string verbatim.
	rep2, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202603-0008", []BulkRow{
		{LeadName: "Toko Dua", PhoneNumber: "0812 111 0002"},
	})
	if err != nil {
		t.Fatalf("BulkImport 2: %v", err)
	}
	if got := leadSource(t, s, rep2.Rows[0].LeadID); got != "Webinar Spesial" {
		t.Errorf("fallback source = %q, want Webinar Spesial", got)
	}
}

// TestBulkImport_Campaign_DerivedSourceWins: a row carrying an explicit Source is
// overridden by the campaign Channel-derived Source (M3 §2 — Channel drives the
// auto-set on every lead imported under the campaign; see DECISIONS/report).
func TestBulkImport_Campaign_DerivedSourceWins(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
	insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", "Active")

	rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202603-0007", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001", Source: "Referral"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	if got := leadSource(t, s, rep.Rows[0].LeadID); got != "Leads - Iklan" {
		t.Fatalf("campaign-derived source must win: got %q, want Leads - Iklan", got)
	}
}

// TestBulkImport_Campaign_AutoActivate: O13 — a Draft or Paused campaign that
// receives an import is AUTO-ACTIVATED (engine transition + a distinct
// campaign_auto_activated audit row, actor = importer) and the import proceeds.
func TestBulkImport_Campaign_AutoActivate(t *testing.T) {
	ctx := context.Background()
	for _, start := range []string{"Draft", "Paused"} {
		s := newService(t)
		testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
		insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", start)

		rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202603-0007", []BulkRow{
			{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001"},
		})
		if err != nil {
			t.Fatalf("[%s] BulkImport: %v", start, err)
		}
		if rep.Imported != 1 {
			t.Fatalf("[%s] imported = %d, want 1", start, rep.Imported)
		}
		if st := campaignStatus(t, s, "CMP-202603-0007"); st != "Active" {
			t.Fatalf("[%s] campaign status = %q, want Active", start, st)
		}
		// Both the engine transition row and the explicit auto-activate row exist.
		entries, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "campaign", EntityID: "CMP-202603-0007"})
		var sawAuto, sawTransition bool
		for _, e := range entries {
			if e.Action == "campaign_auto_activated" {
				sawAuto = true
				if e.ActorEmployeeID != "EMP-LIA" {
					t.Errorf("[%s] auto-activate actor = %q, want EMP-LIA", start, e.ActorEmployeeID)
				}
			}
			if e.Action == "transition:"+start+"->Active" {
				sawTransition = true
			}
		}
		if !sawAuto || !sawTransition {
			t.Fatalf("[%s] audit missing: auto=%v transition=%v", start, sawAuto, sawTransition)
		}
	}
}

// TestBulkImport_Campaign_ClosedArchivedBlock: O13 vs the campaign machine — a
// Closed or Archived campaign has NO legal edge to Active, so the import is
// BLOCKED per-row with the verbatim STATE_MACHINES §2 / M3 §3 Rule 5 message and
// creates nothing.
func TestBulkImport_Campaign_ClosedArchivedBlock(t *testing.T) {
	ctx := context.Background()
	for _, st := range []string{"Closed", "Archived"} {
		s := newService(t)
		testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
		insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", st)

		rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202603-0007", []BulkRow{
			{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001"},
		})
		if err != nil {
			t.Fatalf("[%s] BulkImport: %v", st, err)
		}
		if rep.Imported != 0 || rep.Rejected != 1 {
			t.Fatalf("[%s] imported/rejected = %d/%d, want 0/1", st, rep.Imported, rep.Rejected)
		}
		if rep.Rows[0].Reason != MsgCampaignNotActive {
			t.Fatalf("[%s] reason = %q, want %q", st, rep.Rows[0].Reason, MsgCampaignNotActive)
		}
		if n := countLeads(t, s); n != 0 {
			t.Fatalf("[%s] blocked import created %d leads, want 0", st, n)
		}
	}
}

// TestBulkImport_Campaign_NotFound: a campaign id that does not exist rejects the
// row with the generic not-found message and creates nothing.
func TestBulkImport_Campaign_NotFound(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)

	rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-000000-0000", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	if rep.Rejected != 1 || rep.Rows[0].Reason != MsgCampaignNotFound {
		t.Fatalf("reason = %q (rejected %d), want %q", rep.Rows[0].Reason, rep.Rejected, MsgCampaignNotFound)
	}
	if n := countLeads(t, s); n != 0 {
		t.Fatalf("not-found import created %d leads, want 0", n)
	}
}

// TestBulkImport_Campaign_OriginImmutable_LastTouchMoves: a lead's Origin Campaign
// is set once and never rewritten; a later campaign-scoped touch (here a
// block-as-Pool-duplicate under a different campaign) updates ONLY Last-Touch
// (M1 §5, §9.3).
func TestBulkImport_Campaign_OriginImmutable_LastTouchMoves(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
	insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", "Active")
	insertCampaign(t, s, "CMP-202604-0009", "IG", "Active")

	// Born under cmp1 -> origin = last-touch = cmp1.
	rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202603-0007", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001"},
	})
	if err != nil {
		t.Fatalf("BulkImport cmp1: %v", err)
	}
	lead := rep.Rows[0].LeadID

	// Same phone re-imported under cmp2 -> blocked as Pool duplicate, but last-touch moves.
	rep2, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202604-0009", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "+62 812-111-0001"},
	})
	if err != nil {
		t.Fatalf("BulkImport cmp2: %v", err)
	}
	if rep2.Rows[0].Reason != MsgDuplicatePool {
		t.Fatalf("second import reason = %q, want %q", rep2.Rows[0].Reason, MsgDuplicatePool)
	}
	if o, l := leadCampaigns(t, s, lead); o != "CMP-202603-0007" || l != "CMP-202604-0009" {
		t.Fatalf("after re-touch origin/last-touch = %q/%q, want CMP-202603-0007/CMP-202604-0009", o, l)
	}
}

// TestBulkImport_Campaign_ReopenUpdatesLastTouch: a Rejected/Not-Qualified record
// reopened by a campaign-scoped import keeps its (immutable) origin and takes the
// new campaign as Last-Touch.
func TestBulkImport_Campaign_ReopenUpdatesLastTouch(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
	insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", "Active")
	insertCampaign(t, s, "CMP-202604-0009", "IG", "Active")

	// Seed a terminal ([Not Qualified]) lead whose origin is already cmp1.
	if _, err := s.DB.Exec(
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, origin_campaign_id, last_touch_campaign_id, record_status, created_by)
		 VALUES ('LEAD-SEED-1', 'Old Toko', '0812 999 0001', ?, 'Leads - Iklan', 'Marketing', 'CMP-202603-0007', 'CMP-202603-0007', '[Not Qualified]', 'EMP-LIA')`,
		NormalizePhone("0812 999 0001")); err != nil {
		t.Fatalf("seed terminal lead: %v", err)
	}

	rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "CMP-202604-0009", []BulkRow{
		{LeadName: "Old Toko", PhoneNumber: "0812-999-0001"},
	})
	if err != nil {
		t.Fatalf("BulkImport reopen: %v", err)
	}
	if !rep.Rows[0].Reopened || rep.Rows[0].LeadID != "LEAD-SEED-1" {
		t.Fatalf("row = %+v, want reopened LEAD-SEED-1", rep.Rows[0])
	}
	if o, l := leadCampaigns(t, s, "LEAD-SEED-1"); o != "CMP-202603-0007" || l != "CMP-202604-0009" {
		t.Fatalf("reopen origin/last-touch = %q/%q, want CMP-202603-0007/CMP-202604-0009", o, l)
	}
	if st := campaignStatus(t, s, "CMP-202604-0009"); st != "Active" {
		t.Fatalf("reopen campaign status = %q, want Active", st)
	}
}

// TestBulkImport_NoCampaign_Unchanged: an import with no campaign keeps its per-row
// Source and leaves origin/last-touch NULL (the pre-linkage behaviour is intact).
func TestBulkImport_NoCampaign_Unchanged(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)

	rep, err := s.BulkImport(ctx, mkt("EMP-LIA"), "", []BulkRow{
		{LeadName: "Toko Satu", PhoneNumber: "0812 111 0001", Source: "Referral"},
	})
	if err != nil {
		t.Fatalf("BulkImport: %v", err)
	}
	lead := rep.Rows[0].LeadID
	if got := leadSource(t, s, lead); got != "Referral" {
		t.Errorf("no-campaign source = %q, want Referral", got)
	}
	if o, l := leadCampaigns(t, s, lead); o != "" || l != "" {
		t.Errorf("no-campaign origin/last-touch = %q/%q, want empty", o, l)
	}
	// A row without Source AND without campaign is incomplete.
	rep2, _ := s.BulkImport(ctx, mkt("EMP-LIA"), "", []BulkRow{
		{LeadName: "Toko Dua", PhoneNumber: "0812 111 0002"},
	})
	if rep2.Rows[0].Reason != MsgRowIncomplete {
		t.Errorf("no source + no campaign reason = %q, want %q", rep2.Rows[0].Reason, MsgRowIncomplete)
	}
}

// TestRegister_Campaign: Sales single registration under a campaign derives Source
// from the Channel and stamps origin + last-touch; a missing campaign is rejected.
func TestRegister_Campaign(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	testutil.InsertEmployee(t, s.DB, "EMP-BUDI", "Budi", "budi@mea.co.id", "Sales", "Sales Executive", true)
	testutil.InsertEmployee(t, s.DB, "EMP-LIA", "Lia", "lia@mea.co.id", MarketingDivision, "Marketing Staff", true)
	insertCampaign(t, s, "CMP-202603-0007", "TikTok Ads", "Draft") // Draft -> auto-activates

	lead, _, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Alpha Digital", PhoneNumber: "0812-3456", Source: "Scouting", CampaignID: "CMP-202603-0007",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if lead.Source != "Leads - Iklan" {
		t.Errorf("register source = %q, want Leads - Iklan (campaign-derived)", lead.Source)
	}
	if o, l := leadCampaigns(t, s, lead.ID); o != "CMP-202603-0007" || l != "CMP-202603-0007" {
		t.Errorf("register origin/last-touch = %q/%q, want both CMP-202603-0007", o, l)
	}
	if st := campaignStatus(t, s, "CMP-202603-0007"); st != "Active" {
		t.Errorf("register campaign status = %q, want Active (O13)", st)
	}

	// Missing campaign -> rejected, nothing created.
	_, _, _, err = s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Beta", PhoneNumber: "0813-0000", Source: "Scouting", CampaignID: "CMP-000000-0000",
	})
	var be *ErrBlocked
	if !errors.As(err, &be) || be.Message != MsgCampaignNotFound {
		t.Fatalf("missing-campaign register err = %v, want ErrBlocked %q", err, MsgCampaignNotFound)
	}
}
