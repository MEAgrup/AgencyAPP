package module7_creative

import (
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
)

// seedHoursLogged appends one immutable "hours_logged" audit row for an Asset —
// the exact shape LogHours (hours.go) writes — at an explicit timestamp, so the
// WIB-day bucketing the reminder scan reads can be tested deterministically
// (mirrors seedAssetTransition, daily_output_test.go).
func seedHoursLogged(t *testing.T, k *kit, assetID, actorID string, at time.Time) {
	t.Helper()
	if _, err := k.m7.DB.Exec(
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
		 VALUES ('asset', ?, ?, 'hours_logged', ?, ?)`,
		assetID, actorID, at.UTC(), actorID); err != nil {
		t.Fatal(err)
	}
}

// TestScanHoursReminders_EmitsForActiveUnloggedAsset: (a) an active Asset
// (assigned PIC, [In Progress]) with no Hours logged today gets one reminder to
// its PIC.
func TestScanHoursReminders_EmitsForActiveUnloggedAsset(t *testing.T) {
	k := setup(t)
	k.m7.Catalog = notification.NewCatalog()
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.StartAsset(ctx, creativeStaff("EMP-RIAN"), a.ID); err != nil {
		t.Fatalf("StartAsset: %v", err)
	}

	now := time.Date(2026, 6, 6, 10, 0, 0, 0, time.UTC) // 17:00 WIB
	res, err := k.m7.ScanHoursReminders(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 1 {
		t.Fatalf("RemindersSent = %d, want 1", res.RemindersSent)
	}
	assertAssetNotif(t, k, "EMP-RIAN", notification.EvHoursLoggedReminder, 1)
}

// TestScanHoursReminders_SkipsWhenHoursLoggedToday: (b) an Asset with an
// hours_logged audit row inside today's WIB calendar day is not reminded — the
// WIB/UTC midnight-to-seven edge is exercised the same way
// TestDailyOutput_WIBBucketing_MidnightToSevenEdge does: a log at 2026-06-05
// 18:30 UTC is WIB 2026-06-06 01:30, i.e. "today" for a scan run later on WIB
// 2026-06-06, even though the UTC calendar date differs.
func TestScanHoursReminders_SkipsWhenHoursLoggedToday(t *testing.T) {
	k := setup(t)
	k.m7.Catalog = notification.NewCatalog()
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.StartAsset(ctx, creativeStaff("EMP-RIAN"), a.ID); err != nil {
		t.Fatal(err)
	}
	// 2026-06-05 18:30 UTC == 2026-06-06 01:30 WIB.
	seedHoursLogged(t, k, a.ID, "EMP-RIAN", time.Date(2026, 6, 5, 18, 30, 0, 0, time.UTC))

	// Scan later the same WIB day (2026-06-06 12:00 WIB = 05:00 UTC).
	now := time.Date(2026, 6, 6, 5, 0, 0, 0, time.UTC)
	res, err := k.m7.ScanHoursReminders(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 0 {
		t.Fatalf("RemindersSent = %d, want 0 (hours already logged today WIB)", res.RemindersSent)
	}
	assertAssetNotif(t, k, "EMP-RIAN", notification.EvHoursLoggedReminder, 0)

	// The SAME instant read as the UTC calendar date 2026-06-05 must not count —
	// sanity-checking the log landed in the WIB day the scan actually reads.
	if got := hoursLoggedTodayForTest(t, k, a.ID, time.Date(2026, 6, 5, 3, 0, 0, 0, time.UTC)); got {
		t.Error("hours_logged row must not count toward UTC-date 2026-06-05 / WIB day 2026-06-05")
	}
}

// hoursLoggedTodayForTest is a thin test wrapper around the package-private
// hoursLoggedOnDay, exercised through a fresh transaction.
func hoursLoggedTodayForTest(t *testing.T, k *kit, assetID string, day time.Time) bool {
	t.Helper()
	tx, err := k.m7.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	logged, err := hoursLoggedOnDay(ctx, tx, assetID, day)
	if err != nil {
		t.Fatal(err)
	}
	return logged
}

// TestScanHoursReminders_DedupSameDayThenFiresNextDay: (c) a second scan on the
// SAME WIB day must not double-emit; a scan on the NEXT WIB day (still
// unlogged) fires again — the reminder repeats daily, unlike M5's one-time
// fire-once columns.
func TestScanHoursReminders_DedupSameDayThenFiresNextDay(t *testing.T) {
	k := setup(t)
	k.m7.Catalog = notification.NewCatalog()
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.StartAsset(ctx, creativeStaff("EMP-RIAN"), a.ID); err != nil {
		t.Fatal(err)
	}

	day1Morning := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC)  // 10:00 WIB
	day1Evening := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC) // 19:00 WIB same day

	res, err := k.m7.ScanHoursReminders(ctx, day1Morning)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 1 {
		t.Fatalf("first scan RemindersSent = %d, want 1", res.RemindersSent)
	}
	res, err = k.m7.ScanHoursReminders(ctx, day1Evening)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 0 {
		t.Fatalf("same-day rescan RemindersSent = %d, want 0 (dedup)", res.RemindersSent)
	}
	assertAssetNotif(t, k, "EMP-RIAN", notification.EvHoursLoggedReminder, 1)

	// Next WIB day, still unlogged: fires again.
	day2 := time.Date(2026, 6, 7, 3, 0, 0, 0, time.UTC) // 10:00 WIB next day
	res, err = k.m7.ScanHoursReminders(ctx, day2)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 1 {
		t.Fatalf("next-day scan RemindersSent = %d, want 1", res.RemindersSent)
	}
	assertAssetNotif(t, k, "EMP-RIAN", notification.EvHoursLoggedReminder, 2)
}

// TestScanHoursReminders_SkipsTerminalBlockedAndUnassigned: (d) a terminal
// ([Approved]) Asset, a [Blocked] Asset, and an unassigned (no PIC) Asset are
// never reminded, even with no Hours logged.
func TestScanHoursReminders_SkipsTerminalBlockedAndUnassigned(t *testing.T) {
	k := setup(t)
	k.m7.Catalog = notification.NewCatalog()
	k.m12.Catalog = notification.NewCatalog()
	registerLead(t, k, "EMP-CLEAD", CreativeDivision)
	registerStaff(t, k, "EMP-APPROVED", CreativeDivision)
	registerStaff(t, k, "EMP-BLOCKED", CreativeDivision)
	lead := creativeLead("EMP-CLEAD")

	// Approved (terminal): full happy path to [Approved].
	bApproved, _ := newCreativeBrief(t, k, "approved", 1)
	approvedStaff := creativeStaff("EMP-APPROVED")
	aApproved, err := k.m7.CreateAsset(ctx, approvedStaff, bApproved, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.StartAsset(ctx, approvedStaff, aApproved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.SubmitAsset(ctx, approvedStaff, aApproved.ID, "https://drive.example/1"); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.ReviewAsset(ctx, accountStaff(amID), aApproved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := k.m7.ApproveAsset(ctx, accountStaff(amID), aApproved.ID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "assets", aApproved.ID); got != StatusApproved {
		t.Fatalf("setup: asset status = %q, want %q", got, StatusApproved)
	}

	// Blocked: submit + approve a block request (asset_block_test.go pattern).
	bBlocked, _ := newCreativeBrief(t, k, "blocked", 1)
	blockedStaff := creativeStaff("EMP-BLOCKED")
	aBlocked, err := k.m7.CreateAsset(ctx, blockedStaff, bBlocked, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.StartAsset(ctx, blockedStaff, aBlocked.ID); err != nil {
		t.Fatal(err)
	}
	req, err := k.m12.SubmitAssetBlockRequest(ctx, blockedStaff, aBlocked.ID, "menunggu klien")
	if err != nil {
		t.Fatal(err)
	}
	if err := k.m12.ApproveAssetBlockRequest(ctx, lead, aBlocked.ID, req.ID); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, k, "assets", aBlocked.ID); got != StatusBlocked {
		t.Fatalf("setup: asset status = %q, want %q", got, StatusBlocked)
	}

	// Unassigned: lead creates without a PIC.
	bUnassigned, _ := newCreativeBrief(t, k, "unassigned", 1)
	aUnassigned, err := k.m7.CreateAsset(ctx, lead, bUnassigned, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if aUnassigned.AssignedPIC != "" {
		t.Fatalf("setup: want unassigned asset, got PIC %q", aUnassigned.AssignedPIC)
	}

	now := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC)
	res, err := k.m7.ScanHoursReminders(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 0 {
		t.Fatalf("RemindersSent = %d, want 0 (all three candidates excluded)", res.RemindersSent)
	}
	assertAssetNotif(t, k, "EMP-APPROVED", notification.EvHoursLoggedReminder, 0)
	assertAssetNotif(t, k, "EMP-BLOCKED", notification.EvHoursLoggedReminder, 0)
}

// TestScanHoursReminders_NilCatalogNoOp: mirrors the emitRevisionFlag nil-guard
// (review.go) — with no catalog wired, the scan is a true no-op: it must not
// write hours_reminder_sent_at (which would silently suppress a real reminder
// once a catalog is later wired).
func TestScanHoursReminders_NilCatalogNoOp(t *testing.T) {
	k := setup(t) // k.m7.Catalog is nil by default
	b, _ := newCreativeBrief(t, k, "1", 1)
	registerStaff(t, k, "EMP-RIAN", CreativeDivision)
	a, err := k.m7.CreateAsset(ctx, creativeStaff("EMP-RIAN"), b, AssetInput{SequenceNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.m12.StartAsset(ctx, creativeStaff("EMP-RIAN"), a.ID); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 6, 6, 3, 0, 0, 0, time.UTC)
	res, err := k.m7.ScanHoursReminders(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.RemindersSent != 0 {
		t.Fatalf("RemindersSent = %d, want 0 (nil catalog)", res.RemindersSent)
	}
	var sentAt *time.Time
	if err := k.m7.DB.QueryRow(`SELECT hours_reminder_sent_at FROM assets WHERE id = ?`, a.ID).Scan(&sentAt); err != nil {
		t.Fatal(err)
	}
	if sentAt != nil {
		t.Error("hours_reminder_sent_at must stay NULL when the catalog is nil (no-op, not a silent skip)")
	}
}
