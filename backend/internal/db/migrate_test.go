package db_test

import (
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/db"
)

func TestMigrateUpDown(t *testing.T) {
	d, err := db.Open(db.TestDSN())
	if err != nil {
		t.Skipf("test DB unavailable: %v", err)
	}
	defer d.Close()
	dir := db.FindMigrationsDir()

	// Down all, then up — both directions must work.
	if err := db.MigrateDown(d, dir, 0); err != nil {
		t.Fatalf("migrate down: %v", err)
	}
	if err := db.MigrateUp(d, dir); err != nil {
		t.Fatalf("migrate up: %v", err)
	}

	// Core tables exist after up.
	for _, tbl := range []string{"employees", "audit_log", "id_sequences", "notifications", "master_service_versions", "demo_tasks", "assets", "asset_block_requests"} {
		var name string
		if err := d.QueryRow(`SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?`, tbl).Scan(&name); err != nil {
			t.Fatalf("expected table %s after up: %v", tbl, err)
		}
	}

	// Audit immutability triggers exist.
	var trigCount int
	if err := d.QueryRow(`SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='audit_log'`).Scan(&trigCount); err != nil {
		t.Fatal(err)
	}
	if trigCount < 2 {
		t.Fatalf("expected >=2 audit_log triggers, got %d", trigCount)
	}
}
