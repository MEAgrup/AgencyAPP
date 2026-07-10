package audit_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

func TestAppend_RequiresActor(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	log := audit.NewMySQL()

	_, err := log.Append(ctx, conn, audit.Entry{
		EntityType: "prospect",
		EntityID:   "PRSP-202607-0001",
		Action:     "create",
		At:         time.Now().UTC(),
	})
	if !errors.Is(err, audit.ErrMissingActor) {
		t.Fatalf("err = %v, want ErrMissingActor", err)
	}

	// The failed Append must not have touched the DB.
	var n int
	if err := conn.QueryRow("SELECT COUNT(*) FROM audit_log").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("missing-actor Append wrote %d rows, want 0", n)
	}
}

func TestAppend_RoundTripJSON(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	log := audit.NewMySQL()

	before := json.RawMessage(`{"status": "Baru"}`)
	after := json.RawMessage(`{"status": "Dihubungi"}`)
	at := time.Date(2026, time.July, 10, 9, 30, 15, 123456000, time.UTC)

	id, err := log.Append(ctx, conn, audit.Entry{
		EntityType: "prospect",
		EntityID:   "PRSP-202607-0001",
		Actor:      "EMP-001",
		Action:     "transition",
		Before:     before,
		After:      after,
		At:         at,
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if id <= 0 {
		t.Fatalf("id = %d, want > 0", id)
	}

	recs, err := log.List(ctx, conn, audit.Filter{EntityID: "PRSP-202607-0001"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}
	r := recs[0]
	if r.ID != id {
		t.Fatalf("record id = %d, want %d", r.ID, id)
	}
	if r.EntityType != "prospect" || r.Actor != "EMP-001" || r.Action != "transition" {
		t.Fatalf("scalar fields mismatch: %+v", r)
	}
	if !jsonEqual(t, r.Before, before) {
		t.Fatalf("before = %s, want %s", r.Before, before)
	}
	if !jsonEqual(t, r.After, after) {
		t.Fatalf("after = %s, want %s", r.After, after)
	}
	if !r.At.Equal(at) {
		t.Fatalf("at = %v, want %v", r.At.UTC(), at)
	}
}

func TestAppend_NilBeforeOnCreate(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	log := audit.NewMySQL()

	after := json.RawMessage(`{"status": "Baru"}`)
	_, err := log.Append(ctx, conn, audit.Entry{
		EntityType: "prospect",
		EntityID:   "PRSP-202607-0009",
		Actor:      "system",
		Action:     "create",
		After:      after,
		At:         time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	recs, err := log.List(ctx, conn, audit.Filter{EntityID: "PRSP-202607-0009"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}
	if recs[0].Before != nil {
		t.Fatalf("before = %s, want nil (NULL) on create", recs[0].Before)
	}
}

func TestList_Filters(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	log := audit.NewMySQL()

	base := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	seed := []audit.Entry{
		{EntityType: "prospect", EntityID: "PRSP-202607-0001", Actor: "EMP-001", Action: "create", At: base},
		{EntityType: "prospect", EntityID: "PRSP-202607-0001", Actor: "EMP-001", Action: "transition", At: base.Add(1 * time.Hour)},
		{EntityType: "transaction", EntityID: "TRX-202607-0001", Actor: "EMP-002", Action: "create", At: base.Add(2 * time.Hour)},
		{EntityType: "transaction", EntityID: "TRX-202607-0001", Actor: "EMP-002", Action: "correction", At: base.Add(3 * time.Hour)},
	}
	for _, e := range seed {
		if _, err := log.Append(ctx, conn, e); err != nil {
			t.Fatalf("seed append: %v", err)
		}
	}

	cases := []struct {
		name string
		f    audit.Filter
		want int
	}{
		{"all", audit.Filter{}, 4},
		{"by entity_type", audit.Filter{EntityType: "prospect"}, 2},
		{"by entity_id", audit.Filter{EntityID: "TRX-202607-0001"}, 2},
		{"by actor", audit.Filter{Actor: "EMP-002"}, 2},
		{"by action", audit.Filter{Action: "create"}, 2},
		{"by time window", audit.Filter{From: base.Add(1 * time.Hour), To: base.Add(2 * time.Hour)}, 2},
		{"combined", audit.Filter{EntityType: "prospect", Action: "transition"}, 1},
		{"limit", audit.Filter{Limit: 1}, 1},
		{"offset past end", audit.Filter{Offset: 10}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			recs, err := log.List(ctx, conn, c.f)
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			if len(recs) != c.want {
				t.Fatalf("got %d records, want %d", len(recs), c.want)
			}
		})
	}

	// Verify ascending (chronological) order on the full list.
	all, err := log.List(ctx, conn, audit.Filter{})
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	for i := 1; i < len(all); i++ {
		if all[i].ID <= all[i-1].ID {
			t.Fatalf("not ascending by id at %d: %d <= %d", i, all[i].ID, all[i-1].ID)
		}
	}
}

// Storage-layer immutability: a raw UPDATE on a log row must fail.
func TestImmutable_UpdateBlockedAtStorageLayer(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	log := audit.NewMySQL()

	id, err := log.Append(ctx, conn, audit.Entry{
		EntityType: "prospect", EntityID: "PRSP-202607-0002", Actor: "EMP-001",
		Action: "create", At: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	_, err = conn.ExecContext(ctx, "UPDATE audit_log SET actor = 'HACKER' WHERE id = ?", id)
	if err == nil {
		t.Fatal("UPDATE succeeded, want storage-layer rejection")
	}
	// Row unchanged.
	var actor string
	if err := conn.QueryRow("SELECT actor FROM audit_log WHERE id = ?", id).Scan(&actor); err != nil {
		t.Fatalf("reselect: %v", err)
	}
	if actor != "EMP-001" {
		t.Fatalf("actor = %q, want unchanged EMP-001", actor)
	}
}

// Storage-layer immutability: a raw DELETE on a log row must fail.
func TestImmutable_DeleteBlockedAtStorageLayer(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()
	log := audit.NewMySQL()

	id, err := log.Append(ctx, conn, audit.Entry{
		EntityType: "prospect", EntityID: "PRSP-202607-0003", Actor: "EMP-001",
		Action: "create", At: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}

	_, err = conn.ExecContext(ctx, "DELETE FROM audit_log WHERE id = ?", id)
	if err == nil {
		t.Fatal("DELETE succeeded, want storage-layer rejection")
	}
	var n int
	if err := conn.QueryRow("SELECT COUNT(*) FROM audit_log WHERE id = ?", id).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("row count = %d, want 1 (delete must be blocked)", n)
	}
}

func jsonEqual(t *testing.T, a, b json.RawMessage) bool {
	t.Helper()
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		t.Fatalf("unmarshal a %q: %v", a, err)
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		t.Fatalf("unmarshal b %q: %v", b, err)
	}
	ab, _ := json.Marshal(av)
	bb, _ := json.Marshal(bv)
	return string(ab) == string(bb)
}
