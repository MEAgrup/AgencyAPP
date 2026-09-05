package audit_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func TestWrite_RequiresActor(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	err := audit.Write(ctx, d, audit.Record{EntityType: "x", EntityID: "1", Action: "y"})
	if !errors.Is(err, audit.ErrNoActor) {
		t.Fatalf("expected ErrNoActor, got %v", err)
	}
}

func TestWrite_AndList(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := audit.Write(ctx, d, audit.Record{
			EntityType: "demo_task", EntityID: "DEMO-1", Actor: "EMP-1", Action: "transition",
			Before: map[string]string{"status": "a"}, After: map[string]string{"status": "b"},
		}); err != nil {
			t.Fatal(err)
		}
	}
	// Different entity should not match the filter.
	if err := audit.Write(ctx, d, audit.Record{EntityType: "demo_task", EntityID: "DEMO-2", Actor: "EMP-1", Action: "create"}); err != nil {
		t.Fatal(err)
	}
	entries, err := audit.List(ctx, d, audit.Filter{EntityType: "demo_task", EntityID: "DEMO-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("want 3 entries, got %d", len(entries))
	}
	if entries[0].ID < entries[1].ID {
		t.Fatal("expected newest-first ordering")
	}
}

func TestImmutability_UpdateAndDeleteBlockedAtStorage(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	if err := audit.Write(ctx, d, audit.Record{EntityType: "e", EntityID: "1", Actor: "EMP-1", Action: "create"}); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := d.QueryRow(`SELECT id FROM audit_log LIMIT 1`).Scan(&id); err != nil {
		t.Fatal(err)
	}

	// Direct SQL UPDATE must fail at the storage layer (trigger SIGNAL 45000).
	if _, err := d.Exec(`UPDATE audit_log SET action='tampered' WHERE id=?`, id); err == nil {
		t.Fatal("expected UPDATE on audit_log to be blocked")
	} else if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected UPDATE error: %v", err)
	}

	// Direct SQL DELETE must fail too.
	if _, err := d.Exec(`DELETE FROM audit_log WHERE id=?`, id); err == nil {
		t.Fatal("expected DELETE on audit_log to be blocked")
	} else if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected DELETE error: %v", err)
	}
}
