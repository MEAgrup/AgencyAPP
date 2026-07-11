package seed_test

import (
	"context"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/seed"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func TestSeed_IdempotentAndComplete(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	// Run twice — idempotent.
	if err := seed.Run(ctx, d, ""); err != nil {
		t.Fatalf("seed run 1: %v", err)
	}
	if err := seed.Run(ctx, d, ""); err != nil {
		t.Fatalf("seed run 2: %v", err)
	}

	counts := map[string]int{}
	for _, q := range []struct{ name, sql string }{
		{"employees", "SELECT COUNT(*) FROM employees"},
		{"role_mappings", "SELECT COUNT(*) FROM role_mappings"},
		{"directors", "SELECT COUNT(*) FROM employee_layered_roles WHERE role='director' AND enabled=1"},
		{"master_services", "SELECT COUNT(*) FROM master_services"},
		{"demo_tasks", "SELECT COUNT(*) FROM demo_tasks"},
	} {
		var n int
		if err := d.QueryRow(q.sql).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q.name, err)
		}
		counts[q.name] = n
	}

	if counts["employees"] != 10 {
		t.Errorf("employees=%d want 10", counts["employees"])
	}
	if counts["directors"] != 3 {
		t.Errorf("directors=%d want 3", counts["directors"])
	}
	if counts["master_services"] != 3 {
		t.Errorf("master_services=%d want 3 (idempotent, not 6)", counts["master_services"])
	}
	if counts["demo_tasks"] != 1 {
		t.Errorf("demo_tasks=%d want 1 (idempotent)", counts["demo_tasks"])
	}
}
