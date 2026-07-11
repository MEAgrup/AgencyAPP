package leads

// W1-04 -- junk breakdown query tests (M1 §8 rule 6, M1-OA-7, M1-OA-8).

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// seedJunkLead inserts a lead row directly and optionally forces its final
// record status (test-only shortcut, same rationale as forceRecordStatus:
// the production paths to [Not Qualified]/[Closed - Success] belong to
// W1-03/W1-05).
func seedJunkLead(t *testing.T, conn *sql.DB, l Lead, at time.Time, finalStatus RecordStatus) {
	t.Helper()
	if err := insertLead(context.Background(), conn, l, at); err != nil {
		t.Fatalf("seedJunkLead %s: %v", l.LeadID, err)
	}
	if finalStatus != l.RecordStatus {
		forceRecordStatus(t, conn, l.LeadID, finalStatus)
	}
}

// seedJunkAttempt inserts a prospect_attempts row directly at an arbitrary
// status/reason (test-only; production writes go through module0_sales).
func seedJunkAttempt(t *testing.T, conn *sql.DB, prospectID, leadID, owner string, status statemachine.Status, reason string, at time.Time) {
	t.Helper()
	if _, err := conn.Exec(
		`INSERT INTO prospect_attempts (prospect_id, lead_id, owner_employee_id, status, not_qualified_reason, last_status_at, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		prospectID, leadID, owner, string(status), nullStr(reason), at, at, owner,
	); err != nil {
		t.Fatalf("seedJunkAttempt %s: %v", prospectID, err)
	}
}

// setupJunkFixture builds the AC's mixed ~8-lead fixture:
//
//	CMP-202607-0001 (owner EMP-LIA, source Leads - Iklan):
//	  L..01  2 attempts, both Not Qualified (older [Tidak ada respon],
//	         newer [Bukan seller])            -> junk, reason [Bukan seller]
//	  L..02  1 attempt Not Qualified          -> junk, [Tidak ada respon]
//	  L..03  NQ attempt + Closed-Success      -> NOT junk (not all NQ)
//	  L..04  [Pool], 0 attempts, aged 48h     -> junk (stale, no reason)
//	  L..05  [Pool], 0 attempts, aged 1h      -> NOT junk (fresh)
//	  L..08  1 open attempt (Contacted)       -> NOT junk
//	CMP-202607-0002 (owner EMP-RINA, source Event):
//	  L..06  1 attempt NQ                     -> junk, [Kontak salah/tidak valid]
//	(no campaign, scouted, source Scouting):
//	  L..07  1 attempt NQ                     -> junk, "[Lainnya ...] sudah tutup usaha"
//
// Full-scope expectation: Total 5 = 4 NQ + 1 stale.
func setupJunkFixture(t *testing.T, conn *sql.DB) {
	t.Helper()
	now := time.Now().UTC()

	insertCampaign(t, conn, "CMP-202607-0001", "Active", SourceIklan, "EMP-LIA")
	insertCampaign(t, conn, "CMP-202607-0002", "Active", SourceEvent, "EMP-RINA")

	lead := func(n int, source, campaign string) Lead {
		return Lead{
			LeadID:          "LEAD-202607-000" + string(rune('0'+n)),
			LeadName:        "Junk Fixture " + string(rune('0'+n)),
			PhoneRaw:        "0812-7000-000" + string(rune('0'+n)),
			PhoneNormalized: "8127000000" + string(rune('0'+n)),
			Source:          source,
			OriginDivision:  DivisiMarketing,
			OriginCampaign:  campaign,
			RecordStatus:    StatusPool,
		}
	}

	// L1: contested, both attempts NQ, different reasons; latest wins the
	// attribution ([Bukan seller]).
	seedJunkLead(t, conn, lead(1, SourceIklan, "CMP-202607-0001"), now.Add(-72*time.Hour), StatusNotQualified)
	seedJunkAttempt(t, conn, "PRSP-202607-0901", "LEAD-202607-0001", "EMP-BUDI", statemachine.ProspectNotQualified, "[Tidak ada respon]", now.Add(-2*time.Hour))
	seedJunkAttempt(t, conn, "PRSP-202607-0902", "LEAD-202607-0001", "EMP-ANDI", statemachine.ProspectNotQualified, "[Bukan seller]", now.Add(-1*time.Hour))

	// L2: single NQ attempt.
	seedJunkLead(t, conn, lead(2, SourceIklan, "CMP-202607-0001"), now.Add(-72*time.Hour), StatusNotQualified)
	seedJunkAttempt(t, conn, "PRSP-202607-0903", "LEAD-202607-0002", "EMP-BUDI", statemachine.ProspectNotQualified, "[Tidak ada respon]", now.Add(-3*time.Hour))

	// L3: one NQ + one Closed-Success -> a client, never junk.
	seedJunkLead(t, conn, lead(3, SourceIklan, "CMP-202607-0001"), now.Add(-72*time.Hour), StatusClient)
	seedJunkAttempt(t, conn, "PRSP-202607-0904", "LEAD-202607-0003", "EMP-BUDI", statemachine.ProspectNotQualified, "[Bukan seller]", now.Add(-5*time.Hour))
	seedJunkAttempt(t, conn, "PRSP-202607-0905", "LEAD-202607-0003", "EMP-ANDI", statemachine.ProspectClosedSuccess, "", now.Add(-4*time.Hour))

	// L4: stale pool (48h, zero attempts) -> junk via M1-OA-7.
	seedJunkLead(t, conn, lead(4, SourceIklan, "CMP-202607-0001"), now.Add(-48*time.Hour), StatusPool)

	// L5: fresh pool (1h, zero attempts) -> not junk.
	seedJunkLead(t, conn, lead(5, SourceIklan, "CMP-202607-0001"), now.Add(-1*time.Hour), StatusPool)

	// L6: other campaign/source, single NQ attempt.
	seedJunkLead(t, conn, lead(6, SourceEvent, "CMP-202607-0002"), now.Add(-72*time.Hour), StatusNotQualified)
	seedJunkAttempt(t, conn, "PRSP-202607-0906", "LEAD-202607-0006", "EMP-BUDI", statemachine.ProspectNotQualified, "[Kontak salah/tidak valid]", now.Add(-6*time.Hour))

	// L7: scouted lead (no campaign), NQ with the [Lainnya ...] fallback.
	l7 := lead(7, SourceScouting, "")
	l7.OriginDivision = DivisiSales
	l7.RecordStatus = StatusScoutedActive
	l7.ScoutedOwnerEmployeeID = "EMP-BUDI"
	seedJunkLead(t, conn, l7, now.Add(-72*time.Hour), StatusNotQualified)
	seedJunkAttempt(t, conn, "PRSP-202607-0907", "LEAD-202607-0007", "EMP-BUDI", statemachine.ProspectNotQualified, "[Lainnya ...] sudah tutup usaha", now.Add(-7*time.Hour))

	// L8: open attempt (Contacted) -> not junk; also proves a claimed [Pool]
	// lead is never stale-junk even past the TTL (it has an attempt).
	seedJunkLead(t, conn, lead(8, SourceIklan, "CMP-202607-0001"), now.Add(-72*time.Hour), StatusPool)
	seedJunkAttempt(t, conn, "PRSP-202607-0908", "LEAD-202607-0008", "EMP-ANDI", statemachine.ProspectContacted, "", now.Add(-8*time.Hour))
}

func assertCounts(t *testing.T, got map[string]int, want map[string]int, label string) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s: %d entries, want %d (got %v)", label, len(got), len(want), got)
	}
	for k, w := range want {
		if got[k] != w {
			t.Errorf("%s[%q] = %d, want %d", label, k, got[k], w)
		}
	}
}

// TestJunkBreakdown_ReasonCounts is the ticket's AC: on the mixed fixture the
// breakdown returns the correct junk total and per-reason / per-source /
// per-campaign counts.
func TestJunkBreakdown_ReasonCounts(t *testing.T) {
	conn := testdb.New(t)
	setupJunkFixture(t, conn)
	checker := authz.NewMatrixChecker()

	res, err := JunkBreakdown(context.Background(), conn, idMktLead, checker)
	if err != nil {
		t.Fatalf("JunkBreakdown(marketing lead): %v", err)
	}

	if res.Total != 5 || res.NotQualified != 4 || res.StalePool != 1 {
		t.Errorf("Total/NQ/Stale = %d/%d/%d, want 5/4/1", res.Total, res.NotQualified, res.StalePool)
	}
	assertCounts(t, res.ByReason, map[string]int{
		"[Bukan seller]":                  1, // L1, latest attempt's reason
		"[Tidak ada respon]":              1, // L2
		"[Kontak salah/tidak valid]":      1, // L6
		"[Lainnya ...] sudah tutup usaha": 1, // L7
	}, "ByReason")
	assertCounts(t, res.BySource, map[string]int{
		SourceIklan:    3, // L1, L2, L4(stale)
		SourceEvent:    1, // L6
		SourceScouting: 1, // L7
	}, "BySource")
	assertCounts(t, res.ByCampaign, map[string]int{
		"CMP-202607-0001": 3,
		"CMP-202607-0002": 1,
		"":                1, // scouted L7, no origin campaign
	}, "ByCampaign")

	if len(res.Leads) != 5 {
		t.Fatalf("Leads detail rows = %d, want 5", len(res.Leads))
	}
	// Stale-pool junk carries no reason; NQ junk always carries one.
	for _, j := range res.Leads {
		if j.StalePool && j.NotQualifiedReason != "" {
			t.Errorf("stale lead %s carries reason %q", j.LeadID, j.NotQualifiedReason)
		}
		if !j.StalePool && j.NotQualifiedReason == "" {
			t.Errorf("NQ junk lead %s has no reason", j.LeadID)
		}
	}
}

// TestJunkBreakdown_StaffScopedToOwnCampaigns pins §9.1: Marketing Staff sees
// only the junk of campaigns they own (via campaign_stub.owner_employee_id).
func TestJunkBreakdown_StaffScopedToOwnCampaigns(t *testing.T) {
	conn := testdb.New(t)
	setupJunkFixture(t, conn)
	checker := authz.NewMatrixChecker()
	ctx := context.Background()

	// Lia owns CMP-...-0001 only: L1, L2 (NQ) + L4 (stale). The scouted L7
	// and Rina's campaign are invisible.
	resLia, err := JunkBreakdown(ctx, conn, idMktLia, checker)
	if err != nil {
		t.Fatalf("JunkBreakdown(staff Lia): %v", err)
	}
	if resLia.Total != 3 || resLia.NotQualified != 2 || resLia.StalePool != 1 {
		t.Errorf("Lia Total/NQ/Stale = %d/%d/%d, want 3/2/1", resLia.Total, resLia.NotQualified, resLia.StalePool)
	}
	assertCounts(t, resLia.ByReason, map[string]int{
		"[Bukan seller]":     1,
		"[Tidak ada respon]": 1,
	}, "Lia ByReason")
	assertCounts(t, resLia.ByCampaign, map[string]int{"CMP-202607-0001": 3}, "Lia ByCampaign")

	// Rina owns CMP-...-0002 only: L6.
	resRina, err := JunkBreakdown(ctx, conn, idMktRina, checker)
	if err != nil {
		t.Fatalf("JunkBreakdown(staff Rina): %v", err)
	}
	if resRina.Total != 1 || resRina.NotQualified != 1 || resRina.StalePool != 0 {
		t.Errorf("Rina Total/NQ/Stale = %d/%d/%d, want 1/1/0", resRina.Total, resRina.NotQualified, resRina.StalePool)
	}
	assertCounts(t, resRina.ByReason, map[string]int{"[Kontak salah/tidak valid]": 1}, "Rina ByReason")
}

// TestJunkBreakdown_Permissions covers the remaining §9.1 roles: OD and
// Director full scope (OD read-only is inherent -- the query writes nothing),
// layered Marketing-Staff+OD widened to full scope, Sales staff and unmapped
// identities denied.
func TestJunkBreakdown_Permissions(t *testing.T) {
	conn := testdb.New(t)
	setupJunkFixture(t, conn)
	checker := authz.NewMatrixChecker()
	ctx := context.Background()

	for _, tc := range []struct {
		name  string
		actor authz.Identity
	}{
		{"OD", idODOnly},
		{"Director", idDirector},
		{"Marketing Staff + layered OD", idMktODLayered},
	} {
		t.Run("full scope: "+tc.name, func(t *testing.T) {
			res, err := JunkBreakdown(ctx, conn, tc.actor, checker)
			if err != nil {
				t.Fatalf("JunkBreakdown(%s): %v", tc.name, err)
			}
			if res.Total != 5 {
				t.Errorf("Total = %d, want 5 (full scope)", res.Total)
			}
		})
	}

	for _, tc := range []struct {
		name  string
		actor authz.Identity
	}{
		{"Sales staff", idSalesBudi},
		{"unmapped identity", idUnmapped},
	} {
		t.Run("denied: "+tc.name, func(t *testing.T) {
			_, err := JunkBreakdown(ctx, conn, tc.actor, checker)
			if !errors.Is(err, authz.ErrDenied) {
				t.Fatalf("JunkBreakdown(%s) err = %v, want authz denial", tc.name, err)
			}
		})
	}
}
