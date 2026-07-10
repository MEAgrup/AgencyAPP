package notify

import (
	"context"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/events"
)

// TestDefaultCatalog_EntriesAreAllPlaceholders locks in the current, honest
// state of the v1 catalog: every Phase 0 v2 §9 entry is registered (so the
// event names exist and Center.handle won't silently ignore them once a
// module starts publishing), but since Sprint 0 ships no Wave 1+ module
// tables, every Recipients resolver must fail loudly with a "not yet wired"
// error rather than guess at recipient logic. If this test ever fails
// because a resolver stopped erroring, that's a signal someone replaced a
// placeholder with a real implementation -- which is expected eventually,
// just not from this package/ticket.
func TestDefaultCatalog_EntriesAreAllPlaceholders(t *testing.T) {
	catalog := DefaultCatalog()
	entries := defaultEntries()
	if len(entries) == 0 {
		t.Fatal("expected at least one catalog entry")
	}

	for _, want := range entries {
		got, ok := catalog.Lookup(want.EventName)
		if !ok {
			t.Fatalf("event %q not registered in DefaultCatalog", want.EventName)
		}
		if got.Module == "" {
			t.Errorf("event %q missing Module tag", want.EventName)
		}
		if got.Description == "" {
			t.Errorf("event %q missing Description", want.EventName)
		}

		_, err := got.Recipients(context.Background(), nil, events.Event{Name: want.EventName})
		if err == nil {
			t.Errorf("event %q: expected placeholder Recipients resolver to error (not yet wired)", want.EventName)
		} else if !strings.Contains(err.Error(), "not yet wired") {
			t.Errorf("event %q: expected a 'not yet wired' error, got: %v", want.EventName, err)
		}
	}
}

func TestCatalog_RegisterRejectsDuplicateAndIncompleteEntries(t *testing.T) {
	c := NewCatalog()
	entry := CatalogEntry{
		EventName:  "x.y.z",
		Recipients: notYetWired("test"),
		Render:     func(e events.Event) (string, string, string) { return "t", "b", "" },
	}
	if err := c.Register(entry); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if err := c.Register(entry); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}

	if err := c.Register(CatalogEntry{EventName: "", Recipients: entry.Recipients, Render: entry.Render}); err == nil {
		t.Fatal("expected missing EventName to fail validation")
	}
	if err := c.Register(CatalogEntry{EventName: "a.b.c", Render: entry.Render}); err == nil {
		t.Fatal("expected missing Recipients to fail validation")
	}
	if err := c.Register(CatalogEntry{EventName: "a.b.c", Recipients: entry.Recipients}); err == nil {
		t.Fatal("expected missing Render to fail validation")
	}
}
