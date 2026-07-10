package hris_test

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/hris"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

type sourceFactory func(*testing.T, *fakeDirectory) hris.EmployeeSource

// TestSyncer runs the full Syncer AC suite against both EmployeeSource
// implementations with an identical test body each time — the "swap CSV<->
// HTTP source with zero consumer (Syncer) changes" acceptance criterion.
func TestSyncer(t *testing.T) {
	sources := map[string]sourceFactory{
		"csv":  newCSVSourceFor,
		"http": newHTTPSourceFor,
	}
	for name, newSource := range sources {
		newSource := newSource
		t.Run(name, func(t *testing.T) {
			t.Run("idempotent sync", func(t *testing.T) { testIdempotentSync(t, newSource) })
			t.Run("incremental sync only applies changed rows", func(t *testing.T) { testIncrementalSync(t, newSource) })
			t.Run("deactivation revokes sessions", func(t *testing.T) { testDeactivationRevokesSessions(t, newSource) })
			t.Run("full sync flags absent employees for review", func(t *testing.T) { testFullSyncFlagsMissing(t, newSource) })
			t.Run("two consecutive failures publish admin event", func(t *testing.T) { testTwoConsecutiveFailures(t, newSource) })
		})
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	tt, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse time %q: %v", s, err)
	}
	return tt.UTC()
}

type empRow struct {
	Nama            string
	Email           string
	Divisi          string
	Jabatan         string
	StatusAktif     bool
	HrisUpdatedAt   time.Time
	MissingFromSync bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func fetchEmployee(t *testing.T, db *sql.DB, id string) empRow {
	t.Helper()
	var r empRow
	err := db.QueryRow(`
		SELECT nama, email, divisi, jabatan, status_aktif, hris_updated_at, missing_from_sync, created_at, updated_at
		FROM employees WHERE employee_id = ?`, id).
		Scan(&r.Nama, &r.Email, &r.Divisi, &r.Jabatan, &r.StatusAktif, &r.HrisUpdatedAt, &r.MissingFromSync, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		t.Fatalf("fetch employee %s: %v", id, err)
	}
	return r
}

func insertSession(t *testing.T, db *sql.DB, employeeID, tokenHash string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := db.Exec(`
		INSERT INTO sessions (token_hash, employee_id, created_at, expires_at)
		VALUES (?, ?, ?, ?)`, tokenHash, employeeID, now, now.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}
}

func sessionRevoked(t *testing.T, db *sql.DB, tokenHash string) bool {
	t.Helper()
	var revokedAt sql.NullTime
	if err := db.QueryRow(`SELECT revoked_at FROM sessions WHERE token_hash = ?`, tokenHash).Scan(&revokedAt); err != nil {
		t.Fatalf("query session: %v", err)
	}
	return revokedAt.Valid
}

func testIdempotentSync(t *testing.T, newSource sourceFactory) {
	db := testdb.New(t)
	dir := newFakeDirectory(
		hris.Employee{EmployeeID: "EMP-0001", Nama: "Sinta Rahma", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "Account Manager", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00+07:00")},
		hris.Employee{EmployeeID: "EMP-0002", Nama: "Budi Santoso", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T09:00:00+07:00")},
	)
	src := newSource(t, dir)

	clock := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC)
	syncer := &hris.Syncer{DB: db, Now: func() time.Time { return clock }}
	ctx := context.Background()

	res1, err := syncer.Sync(ctx, src, time.Time{})
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if res1.Created != 2 || res1.Updated != 0 || res1.Unchanged != 0 {
		t.Fatalf("first sync result = %+v, want 2 created", res1)
	}
	row1 := fetchEmployee(t, db, "EMP-0001")

	// Sync the exact same payload again, clock ticking forward: rows must be
	// identical, and updated_at must NOT bump for unchanged rows.
	clock = clock.Add(time.Hour)
	res2, err := syncer.Sync(ctx, src, time.Time{})
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if res2.Created != 0 || res2.Updated != 0 || res2.Unchanged != 2 {
		t.Fatalf("second sync result = %+v, want all unchanged", res2)
	}
	row2 := fetchEmployee(t, db, "EMP-0001")
	if !row1.UpdatedAt.Equal(row2.UpdatedAt) {
		t.Fatalf("updated_at bumped on unchanged sync: %v -> %v", row1.UpdatedAt, row2.UpdatedAt)
	}
	if !row1.CreatedAt.Equal(row2.CreatedAt) {
		t.Fatalf("created_at changed across syncs: %v -> %v", row1.CreatedAt, row2.CreatedAt)
	}

	// Now change one field for one employee: only that row should update,
	// and its updated_at (but not the other row's) should bump.
	other := fetchEmployee(t, db, "EMP-0002")
	dir.set([]hris.Employee{
		{EmployeeID: "EMP-0001", Nama: "Sinta Rahma Wijaya", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "Account Manager", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-05T08:00:00+07:00")},
		{EmployeeID: "EMP-0002", Nama: "Budi Santoso", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T09:00:00+07:00")},
	})
	clock = clock.Add(time.Hour)
	res3, err := syncer.Sync(ctx, src, time.Time{})
	if err != nil {
		t.Fatalf("third sync: %v", err)
	}
	if res3.Created != 0 || res3.Updated != 1 || res3.Unchanged != 1 {
		t.Fatalf("third sync result = %+v, want exactly 1 updated", res3)
	}
	row3 := fetchEmployee(t, db, "EMP-0001")
	if row3.Nama != "Sinta Rahma Wijaya" {
		t.Fatalf("nama not updated: %+v", row3)
	}
	if row3.UpdatedAt.Equal(row1.UpdatedAt) {
		t.Fatalf("updated_at did not bump on real change")
	}
	other2 := fetchEmployee(t, db, "EMP-0002")
	if !other.UpdatedAt.Equal(other2.UpdatedAt) {
		t.Fatalf("unrelated row's updated_at changed: %v -> %v", other.UpdatedAt, other2.UpdatedAt)
	}
}

func testIncrementalSync(t *testing.T, newSource sourceFactory) {
	db := testdb.New(t)
	t1 := mustTime(t, "2026-07-01T08:00:00Z")
	t2 := mustTime(t, "2026-07-02T08:00:00Z")
	dir := newFakeDirectory(
		hris.Employee{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: t1},
		hris.Employee{EmployeeID: "EMP-0002", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: t2},
	)
	src := newSource(t, dir)
	syncer := &hris.Syncer{DB: db}
	ctx := context.Background()

	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("initial full sync: %v", err)
	}
	before2 := fetchEmployee(t, db, "EMP-0002")

	// Only EMP-0001 changes, and the incremental cursor is set after t2 (the
	// last time EMP-0002 changed) so an HRIS "updated_since" query returns
	// only EMP-0001's new update, never touching EMP-0002.
	since := t2.Add(12 * time.Hour)
	t3 := since.Add(time.Hour) // after since
	dir.set([]hris.Employee{
		{EmployeeID: "EMP-0001", Nama: "Sinta Rahma", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: t3},
		{EmployeeID: "EMP-0002", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: t2},
	})

	res, err := syncer.Sync(ctx, src, since)
	if err != nil {
		t.Fatalf("incremental sync: %v", err)
	}
	if res.Fetched != 1 || res.Updated != 1 || res.Created != 0 {
		t.Fatalf("incremental sync result = %+v, want exactly 1 fetched+updated", res)
	}
	if res.FlaggedMissing != 0 {
		t.Fatalf("incremental sync must never flag missing employees, got %+v", res)
	}

	got1 := fetchEmployee(t, db, "EMP-0001")
	if got1.Nama != "Sinta Rahma" {
		t.Fatalf("EMP-0001 not updated by incremental sync: %+v", got1)
	}
	got2 := fetchEmployee(t, db, "EMP-0002")
	if !got2.UpdatedAt.Equal(before2.UpdatedAt) || got2.MissingFromSync {
		t.Fatalf("EMP-0002 must be untouched by an incremental sync that didn't fetch it: %+v", got2)
	}
}

func testDeactivationRevokesSessions(t *testing.T, newSource sourceFactory) {
	db := testdb.New(t)
	dir := newFakeDirectory(
		hris.Employee{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00Z")},
	)
	src := newSource(t, dir)
	syncer := &hris.Syncer{DB: db}
	ctx := context.Background()

	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("initial sync: %v", err)
	}

	tokenHash := strings.Repeat("a", 64)
	insertSession(t, db, "EMP-0001", tokenHash)
	if sessionRevoked(t, db, tokenHash) {
		t.Fatalf("session revoked before any deactivation")
	}

	dir.set([]hris.Employee{
		{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: false, UpdatedAt: mustTime(t, "2026-07-05T08:00:00Z")},
	})
	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("deactivation sync: %v", err)
	}

	if !sessionRevoked(t, db, tokenHash) {
		t.Fatalf("session was not revoked after HRIS deactivation")
	}
	row := fetchEmployee(t, db, "EMP-0001")
	if row.StatusAktif {
		t.Fatalf("employee row still shows active after deactivation sync")
	}
}

func testFullSyncFlagsMissing(t *testing.T, newSource sourceFactory) {
	db := testdb.New(t)
	dir := newFakeDirectory(
		hris.Employee{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00Z")},
		hris.Employee{EmployeeID: "EMP-0002", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T09:00:00Z")},
	)
	src := newSource(t, dir)
	bus := &recordingBus{}
	syncer := &hris.Syncer{DB: db, Bus: bus}
	ctx := context.Background()

	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("initial full sync: %v", err)
	}

	// EMP-0002 has a live session; when they vanish from the sync their CDPS
	// access must be revoked (an HRIS-removed employee loses access next sync).
	tokenHash := strings.Repeat("b", 64)
	insertSession(t, db, "EMP-0002", tokenHash)
	if sessionRevoked(t, db, tokenHash) {
		t.Fatalf("session revoked before employee went missing")
	}

	// EMP-0002 disappears from a subsequent full sync payload.
	dir.set([]hris.Employee{
		{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00Z")},
	})
	res, err := syncer.Sync(ctx, src, time.Time{})
	if err != nil {
		t.Fatalf("second full sync: %v", err)
	}
	if res.FlaggedMissing != 1 {
		t.Fatalf("expected exactly 1 newly flagged employee, got %+v", res)
	}
	if !sessionRevoked(t, db, tokenHash) {
		t.Fatalf("session of missing employee was not revoked")
	}

	row := fetchEmployee(t, db, "EMP-0002")
	if !row.MissingFromSync {
		t.Fatalf("EMP-0002 should be flagged missing_from_sync, got %+v", row)
	}
	// Never deleted: the audit trail / row itself is preserved.
	if row.Nama != "Budi" {
		t.Fatalf("EMP-0002 row should be preserved, not altered/deleted: %+v", row)
	}

	if bus.count(hris.EventEmployeeMissing) != 1 {
		t.Fatalf("expected exactly 1 missing-employee admin event, got %d", bus.count(hris.EventEmployeeMissing))
	}
	names := bus.namesFor("employee")
	if len(names) != 1 || names[0] != "EMP-0002" {
		t.Fatalf("missing event entity_id = %v, want [EMP-0002]", names)
	}

	// A third full sync with the same (still-absent) state must not
	// re-flag or re-publish (already flagged rows are left alone).
	res3, err := syncer.Sync(ctx, src, time.Time{})
	if err != nil {
		t.Fatalf("third full sync: %v", err)
	}
	if res3.FlaggedMissing != 0 {
		t.Fatalf("already-flagged employee re-flagged: %+v", res3)
	}
	if bus.count(hris.EventEmployeeMissing) != 1 {
		t.Fatalf("missing event re-published: now %d", bus.count(hris.EventEmployeeMissing))
	}

	// If the employee reappears, the flag must clear.
	dir.set([]hris.Employee{
		{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00Z")},
		{EmployeeID: "EMP-0002", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-10T08:00:00Z")},
	})
	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("reappearance sync: %v", err)
	}
	row = fetchEmployee(t, db, "EMP-0002")
	if row.MissingFromSync {
		t.Fatalf("EMP-0002 should no longer be flagged missing after reappearing: %+v", row)
	}
}

// TestSyncerAudits verifies FIX 4 (CLAUDE.md convention #3): a Syncer wired
// with an Audit logger appends one history row per employee-row mutation, and
// an unchanged re-sync appends none.
func TestSyncerAudits(t *testing.T) {
	db := testdb.New(t)
	dir := newFakeDirectory(
		hris.Employee{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00Z")},
		hris.Employee{EmployeeID: "EMP-0002", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T09:00:00Z")},
	)
	src := newCSVSourceFor(t, dir)
	logger := audit.NewMySQL()
	syncer := &hris.Syncer{DB: db, Audit: logger}
	ctx := context.Background()

	countEmployeeAudit := func() int {
		recs, err := logger.List(ctx, db, audit.Filter{EntityType: "employee", Limit: 1000})
		if err != nil {
			t.Fatalf("list audit: %v", err)
		}
		return len(recs)
	}
	countAction := func(action string) int {
		recs, err := logger.List(ctx, db, audit.Filter{EntityType: "employee", Action: action, Limit: 1000})
		if err != nil {
			t.Fatalf("list audit: %v", err)
		}
		return len(recs)
	}

	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if got := countEmployeeAudit(); got != 2 {
		t.Fatalf("first sync of 2 employees should append 2 audit rows, got %d", got)
	}
	if got := countAction("create"); got != 2 {
		t.Fatalf("expected 2 create audit rows, got %d", got)
	}

	// Unchanged re-sync: no mutations, so no new audit rows.
	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if got := countEmployeeAudit(); got != 2 {
		t.Fatalf("unchanged re-sync must append no audit rows, total = %d", got)
	}

	// One field change → exactly one "update" audit row.
	dir.set([]hris.Employee{
		{EmployeeID: "EMP-0001", Nama: "Sinta Rahma", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-05T08:00:00Z")},
		{EmployeeID: "EMP-0002", Nama: "Budi", Email: "budi@mea.co.id", Divisi: "Creative", Jabatan: "Designer", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T09:00:00Z")},
	})
	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("update sync: %v", err)
	}
	if got := countAction("update"); got != 1 {
		t.Fatalf("expected 1 update audit row, got %d", got)
	}
	if got := countEmployeeAudit(); got != 3 {
		t.Fatalf("expected 3 total employee audit rows, got %d", got)
	}
}

func testTwoConsecutiveFailures(t *testing.T, newSource sourceFactory) {
	db := testdb.New(t)
	dir := newFakeDirectory(
		hris.Employee{EmployeeID: "EMP-0001", Nama: "Sinta", Email: "sinta@mea.co.id", Divisi: "Account", Jabatan: "AM", StatusAktif: true, UpdatedAt: mustTime(t, "2026-07-01T08:00:00Z")},
	)
	src := newSource(t, dir)
	bus := &recordingBus{}
	syncer := &hris.Syncer{DB: db, Bus: bus}
	ctx := context.Background()

	dir.failNextCalls(2)

	if _, err := syncer.Sync(ctx, src, time.Time{}); err == nil {
		t.Fatalf("expected first sync to fail")
	}
	if got := bus.count(hris.EventSyncFailed); got != 0 {
		t.Fatalf("admin event fired after only 1 failure: %d", got)
	}

	if _, err := syncer.Sync(ctx, src, time.Time{}); err == nil {
		t.Fatalf("expected second sync to fail")
	}
	if got := bus.count(hris.EventSyncFailed); got != 1 {
		t.Fatalf("expected admin event after 2 consecutive failures, got %d", got)
	}

	// A subsequent success resets the counter; one more isolated failure
	// afterwards must not immediately re-fire the alert.
	if _, err := syncer.Sync(ctx, src, time.Time{}); err != nil {
		t.Fatalf("expected recovery sync to succeed: %v", err)
	}
	dir.failNextCalls(1)
	if _, err := syncer.Sync(ctx, src, time.Time{}); err == nil {
		t.Fatalf("expected sync to fail")
	}
	if got := bus.count(hris.EventSyncFailed); got != 1 {
		t.Fatalf("failure counter did not reset after a success: event count = %d", got)
	}
}
