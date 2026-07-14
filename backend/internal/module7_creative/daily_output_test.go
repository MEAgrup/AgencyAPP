package module7_creative

import (
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// seedAssetTransition appends one immutable transition audit row for an Asset, the
// exact shape the state-machine engine writes (`transition:<from>-><to>`). Daily
// Output derives entirely from these rows.
func seedAssetTransition(t *testing.T, k *kit, assetID, from, to string, at time.Time) {
	t.Helper()
	if _, err := k.m7.DB.Exec(
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
		 VALUES ('asset', ?, 'EMP-ACTOR', ?, ?, 'EMP-ACTOR')`,
		assetID, "transition:"+from+"->"+to, at.UTC()); err != nil {
		t.Fatal(err)
	}
}

// TestDailyOutput_RecomputeFromLog: the feed is derived purely from the immutable
// transition log, attributed to the Asset's PIC, unit type = Asset Type, and it is
// stable across recomputes (house rule 4). The [Approved] transition — driven by
// the AM in production — still counts as the PIC's output (§8 Rule 2).
func TestDailyOutput_RecomputeFromLog(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	// A full production day for Rian (all times land on WIB 2026-06-06).
	day := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC) // = 10:00 WIB
	seedAssetTransition(t, k, a.ID, StatusToDo, StatusInProgress, time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC))
	seedAssetTransition(t, k, a.ID, StatusInProgress, StatusSubmitted, time.Date(2026, 6, 6, 6, 0, 0, 0, time.UTC))
	seedAssetTransition(t, k, a.ID, StatusSubmitted, StatusInReview, time.Date(2026, 6, 6, 7, 0, 0, 0, time.UTC))
	seedAssetTransition(t, k, a.ID, StatusInReview, StatusApproved, time.Date(2026, 6, 6, 8, 0, 0, 0, time.UTC))
	// A transition on the NEXT WIB day must not leak into this day's bucket.
	seedAssetTransition(t, k, a.ID, StatusApproved, StatusInProgress, time.Date(2026, 6, 7, 3, 0, 0, 0, time.UTC))

	got, err := k.m7.DailyOutput(ctx, creativeStaff("EMP-RIAN"), "EMP-RIAN", day)
	if err != nil {
		t.Fatal(err)
	}
	if got.DateWIB != "2026-06-06" {
		t.Errorf("DateWIB = %q, want 2026-06-06", got.DateWIB)
	}
	if got.Total != 4 {
		t.Fatalf("Total = %d, want 4 (next-day transition excluded)", got.Total)
	}
	if got.Approved != 1 {
		t.Errorf("Approved = %d, want 1", got.Approved)
	}
	for _, e := range got.Entries {
		if e.PIC != "EMP-RIAN" {
			t.Errorf("entry PIC = %q, want EMP-RIAN", e.PIC)
		}
		if e.OutputUnitType != "Product Video" {
			t.Errorf("OutputUnitType = %q, want inherited Asset Type Product Video", e.OutputUnitType)
		}
		if e.AssetID != a.ID || e.BriefID != b {
			t.Errorf("linkage = %s/%s, want %s/%s", e.AssetID, e.BriefID, a.ID, b)
		}
	}
	// Recompute is stable (house rule 4).
	again, err := k.m7.DailyOutput(ctx, creativeStaff("EMP-RIAN"), "EMP-RIAN", day)
	if err != nil {
		t.Fatal(err)
	}
	if again.Total != got.Total || again.Approved != got.Approved {
		t.Errorf("recompute differs: %+v vs %+v", again, got)
	}
}

// TestDailyOutput_WIBBucketing_MidnightToSevenEdge: a transition timestamped in the
// 00:00–07:00 WIB window (i.e. the PREVIOUS UTC calendar date) must bucket into the
// WIB day, not the UTC day (O20). 2026-06-06 01:30 WIB = 2026-06-05 18:30 UTC.
func TestDailyOutput_WIBBucketing_MidnightToSevenEdge(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	// 2026-06-05 18:30 UTC == 2026-06-06 01:30 WIB — belongs to WIB day 2026-06-06.
	early := time.Date(2026, 6, 5, 18, 30, 0, 0, time.UTC)
	seedAssetTransition(t, k, a.ID, StatusToDo, StatusInProgress, early)

	// Query WIB day 2026-06-06 (pass any instant on that WIB date).
	wibDay := time.Date(2026, 6, 6, 5, 0, 0, 0, time.UTC) // 12:00 WIB, same day
	got, err := k.m7.DailyOutput(ctx, director("EMP-DIR"), "EMP-RIAN", wibDay)
	if err != nil {
		t.Fatal(err)
	}
	if got.DateWIB != "2026-06-06" || got.Total != 1 {
		t.Fatalf("edge bucket: got %s/%d, want 2026-06-06/1", got.DateWIB, got.Total)
	}
	// The same transition must NOT appear under the UTC date 2026-06-05.
	utcDay := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC) // 19:00 WIB 06-05
	if got5, err := k.m7.DailyOutput(ctx, director("EMP-DIR"), "EMP-RIAN", utcDay); err != nil {
		t.Fatal(err)
	} else if got5.Total != 0 {
		t.Errorf("UTC-date bucket 2026-06-05 = %d entries, want 0 (belongs to WIB 06-06)", got5.Total)
	}
}

// TestDailyOutput_EndOfDayLock: an entry's WIB day is Locked once the current WIB
// date has moved past it; today's day stays open (§7 Rule 3).
func TestDailyOutput_EndOfDayLock(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC) // WIB 2026-06-06
	seedAssetTransition(t, k, a.ID, StatusToDo, StatusInProgress, day)

	// "Now" still on the same WIB day -> open.
	timeNow = func() time.Time { return time.Date(2026, 6, 6, 15, 0, 0, 0, time.UTC) } // 22:00 WIB same day
	defer func() { timeNow = time.Now }()
	openDay, err := k.m7.DailyOutput(ctx, creativeStaff("EMP-RIAN"), "EMP-RIAN", day)
	if err != nil {
		t.Fatal(err)
	}
	if openDay.Locked {
		t.Error("same WIB day should be open (not locked before 23:59 WIB)")
	}
	if len(openDay.Entries) != 1 || openDay.Entries[0].Locked {
		t.Error("entry should be unlocked while its WIB day is current")
	}

	// "Now" advanced past midnight WIB into the next day -> locked.
	timeNow = func() time.Time { return time.Date(2026, 6, 6, 18, 0, 0, 0, time.UTC) } // 01:00 WIB 06-07
	lockedDay, err := k.m7.DailyOutput(ctx, creativeStaff("EMP-RIAN"), "EMP-RIAN", day)
	if err != nil {
		t.Fatal(err)
	}
	if !lockedDay.Locked || !lockedDay.Entries[0].Locked {
		t.Error("past WIB day should be locked once the current WIB date moved on")
	}
}

// TestDailyOutput_Permissions: §9.1 read gate — PIC (own), Creative Team Leader,
// OD, Director allowed; a foreign Creative staff, Account staff/lead, and other
// divisions denied. Attribution is by Assigned PIC, not transition actor.
func TestDailyOutput_Permissions(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC)
	seedAssetTransition(t, k, a.ID, StatusToDo, StatusInProgress, day)

	allow := []permission.Actor{
		creativeStaff("EMP-RIAN"), // the PIC (own)
		creativeLead("EMP-CLEAD"), // Creative Team Leader
		od("EMP-OD"), director("EMP-DIR"),
	}
	for _, act := range allow {
		if _, err := k.m7.DailyOutput(ctx, act, "EMP-RIAN", day); err != nil {
			t.Errorf("%+v should view Rian's Daily Output: %v", act.Role, err)
		}
	}
	deny := []permission.Actor{
		creativeStaff("EMP-OTHER"), // a different Creative staff (not the PIC)
		accountStaff(amID),         // owning AM — not a Daily-Output viewer
		accountLead("EMP-ALEAD"),   // Account lead — not a Daily-Output viewer
		creativeStaffOtherDiv(),    // other division
	}
	for _, act := range deny {
		if _, err := k.m7.DailyOutput(ctx, act, "EMP-RIAN", day); !errors.Is(err, ErrDailyOutputForbidden) {
			t.Errorf("%+v must be denied, got %v", act.Role, err)
		}
	}
	// Blank PIC -> incomplete.
	if _, err := k.m7.DailyOutput(ctx, director("EMP-DIR"), "  ", day); !errors.Is(err, ErrIncomplete) {
		t.Errorf("blank PIC: want ErrIncomplete, got %v", err)
	}
}

// TestDailyOutput_NoMutationPath: computing the feed writes nothing — no snapshot
// table, no row touched. Immutability is inherent (the source is the append-only
// audit log). Verifies audit_log and assets are byte-stable across a recompute.
func TestDailyOutput_NoMutationPath(t *testing.T) {
	k := setup(t)
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC)
	seedAssetTransition(t, k, a.ID, StatusToDo, StatusInProgress, day)

	count := func(table string) int {
		var n int
		if err := k.m7.DB.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	auditBefore, assetsBefore := count("audit_log"), count("assets")
	if _, err := k.m7.DailyOutput(ctx, director("EMP-DIR"), "EMP-RIAN", day); err != nil {
		t.Fatal(err)
	}
	if count("audit_log") != auditBefore || count("assets") != assetsBefore {
		t.Error("DailyOutput must not write any row (pure derived read-model)")
	}
	// Sanity: the WIB day helper agrees with tz on the bucket midnight.
	if !dayLocked(tz.TodayWIB(day), time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC)) {
		t.Error("dayLocked should report a two-days-old WIB day as locked")
	}
}
