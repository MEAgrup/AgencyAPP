package notify

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// testEvent is a synthetic cataloged event used to exercise Center's fan-out
// machinery in isolation from the real (currently all-placeholder) v1
// catalog -- see catalog.go's DefaultCatalog doc comment for why every
// production entry is a notYetWired placeholder in Sprint 0.
const testEvent = "test.synthetic.event"

func TestCenter_CatalogedEventCreatesNotificationsForResolvedRecipients(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	catalog := NewCatalog()
	if err := catalog.Register(CatalogEntry{
		EventName:   testEvent,
		Module:      "TEST",
		Description: "synthetic event for Center AC tests",
		Recipients: func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
			return []string{"EMP-000001", "EMP-000002"}, nil
		},
		Render: func(e events.Event) (title, body, deepLink string) {
			return "Deal needs approval", "Deal " + e.EntityID + " needs approval", "/deal/" + e.EntityID
		},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}

	center := NewCenter(catalog)
	bus := events.NewInMemoryBus()
	center.Subscribe(bus, conn)

	bus.Publish(ctx, events.Event{
		Name:       testEvent,
		EntityType: "deal",
		EntityID:   "DEAL-202607-0001",
		Actor:      "EMP-000009",
		At:         time.Now().UTC(),
		Payload:    map[string]any{"amount": float64(1000)},
	})

	for _, emp := range []string{"EMP-000001", "EMP-000002"} {
		inbox, err := center.Inbox(ctx, conn, emp, false, 10, 0)
		if err != nil {
			t.Fatalf("inbox for %s: %v", emp, err)
		}
		if len(inbox) != 1 {
			t.Fatalf("expected 1 notification for %s, got %d", emp, len(inbox))
		}
		n := inbox[0]
		if n.Title != "Deal needs approval" {
			t.Errorf("title = %q", n.Title)
		}
		if n.DeepLink != "/deal/DEAL-202607-0001" {
			t.Errorf("deep link = %q", n.DeepLink)
		}
		if n.EntityType != "deal" || n.EntityID != "DEAL-202607-0001" {
			t.Errorf("entity = %s/%s", n.EntityType, n.EntityID)
		}
		if len(n.PayloadJSON) == 0 {
			t.Errorf("expected payload json to be recorded")
		}
		var payload map[string]any
		if err := json.Unmarshal(n.PayloadJSON, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if payload["amount"] != float64(1000) {
			t.Errorf("payload amount = %v", payload["amount"])
		}
		if n.IsRead() {
			t.Errorf("expected unread notification")
		}
	}

	// A third employee who was not resolved as a recipient gets nothing.
	inbox, err := center.Inbox(ctx, conn, "EMP-000003", false, 10, 0)
	if err != nil {
		t.Fatalf("inbox for EMP-000003: %v", err)
	}
	if len(inbox) != 0 {
		t.Fatalf("expected 0 notifications for unrelated employee, got %d", len(inbox))
	}
}

func TestCenter_UncatalogedEventCreatesNothing(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	catalog := NewCatalog() // nothing registered
	center := NewCenter(catalog)
	bus := events.NewInMemoryBus()
	center.Subscribe(bus, conn)

	bus.Publish(ctx, events.Event{
		Name:       "some.uncataloged.event",
		EntityType: "deal",
		EntityID:   "DEAL-202607-0002",
		Actor:      "EMP-000009",
		At:         time.Now().UTC(),
	})

	var count int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM notifications").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 rows for uncataloged event, got %d", count)
	}
}

func TestCenter_MarkReadDropsUnreadCountAndIsIdempotent(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	catalog := NewCatalog()
	if err := catalog.Register(CatalogEntry{
		EventName: testEvent,
		Module:    "TEST",
		Recipients: func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
			return []string{"EMP-000001"}, nil
		},
		Render: func(e events.Event) (string, string, string) { return "T", "B", "/x" },
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	center := NewCenter(catalog)
	bus := events.NewInMemoryBus()
	center.Subscribe(bus, conn)

	bus.Publish(ctx, events.Event{Name: testEvent, EntityID: "1", At: time.Now().UTC()})

	count, err := center.UnreadCount(ctx, conn, "EMP-000001")
	if err != nil {
		t.Fatalf("unread count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected unread count 1, got %d", count)
	}

	inbox, err := center.Inbox(ctx, conn, "EMP-000001", true, 10, 0)
	if err != nil {
		t.Fatalf("inbox: %v", err)
	}
	if len(inbox) != 1 {
		t.Fatalf("expected 1 unread notification, got %d", len(inbox))
	}
	id := inbox[0].ID

	if err := center.MarkRead(ctx, conn, "EMP-000001", id); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	count, err = center.UnreadCount(ctx, conn, "EMP-000001")
	if err != nil {
		t.Fatalf("unread count after mark read: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected unread count 0 after mark read, got %d", count)
	}

	// Idempotent: marking an already-read notification read again succeeds.
	if err := center.MarkRead(ctx, conn, "EMP-000001", id); err != nil {
		t.Fatalf("mark read again: %v", err)
	}
}

func TestCenter_MarkReadOnAnotherUsersNotificationFails(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	catalog := NewCatalog()
	if err := catalog.Register(CatalogEntry{
		EventName: testEvent,
		Module:    "TEST",
		Recipients: func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
			return []string{"EMP-000001"}, nil
		},
		Render: func(e events.Event) (string, string, string) { return "T", "B", "/x" },
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	center := NewCenter(catalog)
	bus := events.NewInMemoryBus()
	center.Subscribe(bus, conn)

	bus.Publish(ctx, events.Event{Name: testEvent, EntityID: "1", At: time.Now().UTC()})

	inbox, err := center.Inbox(ctx, conn, "EMP-000001", false, 10, 0)
	if err != nil || len(inbox) != 1 {
		t.Fatalf("inbox: %v, %d", err, len(inbox))
	}
	id := inbox[0].ID

	err = center.MarkRead(ctx, conn, "EMP-999999", id)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}

	err = center.MarkRead(ctx, conn, "EMP-000001", 999999999)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// TestCenter_ReplaceWiresRealResolverAndNotificationLands proves an owning
// module can swap a DefaultCatalog notYetWired placeholder for a real
// resolver via Center.Replace, after which the event fans out to a real
// notification row. It also checks Replace of an unknown event errors.
func TestCenter_ReplaceWiresRealResolverAndNotificationLands(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	center := NewCenter(DefaultCatalog())

	// Replacing an event that was never registered must error (use Register).
	if err := center.Replace(CatalogEntry{
		EventName:  "does.not.exist",
		Recipients: func(context.Context, db.Queryer, events.Event) ([]string, error) { return []string{"EMP-000001"}, nil },
		Render:     func(events.Event) (string, string, string) { return "t", "b", "" },
	}); err == nil {
		t.Fatal("expected Replace of unregistered event to error")
	}

	const eventName = "m9.qc_or_booking.escalated" // a real DefaultCatalog placeholder
	if err := center.Replace(CatalogEntry{
		EventName:   eventName,
		Module:      "M9",
		Description: "wired for test",
		Recipients: func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
			return []string{"EMP-000042"}, nil
		},
		Render: func(e events.Event) (title, body, deepLink string) {
			return "Booking escalated", "b", "/booking/" + e.EntityID
		},
	}); err != nil {
		t.Fatalf("replace: %v", err)
	}

	bus := events.NewInMemoryBus()
	center.Subscribe(bus, conn)
	bus.Publish(ctx, events.Event{
		Name:       eventName,
		EntityType: "creator_booking",
		EntityID:   "BKG-202607-0001",
		At:         time.Now().UTC(),
	})

	inbox, err := center.Inbox(ctx, conn, "EMP-000042", false, 10, 0)
	if err != nil {
		t.Fatalf("inbox: %v", err)
	}
	if len(inbox) != 1 {
		t.Fatalf("expected 1 notification after Replace-wired resolver, got %d", len(inbox))
	}
	if inbox[0].Title != "Booking escalated" {
		t.Errorf("title = %q, want %q", inbox[0].Title, "Booking escalated")
	}
	if inbox[0].EventName != eventName {
		t.Errorf("event name = %q, want %q", inbox[0].EventName, eventName)
	}
}

func TestNotifications_DirectDeleteIsBlockedByTrigger(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	mustInsert(t, ctx, conn, "EMP-000001", "row title")

	_, err := conn.ExecContext(ctx, "DELETE FROM notifications")
	if err == nil {
		t.Fatal("expected DELETE to be blocked by the notifications_no_delete trigger")
	}
}

func TestNotifications_DirectUpdateOfTitleIsBlockedButReadAtSucceeds(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	id := mustInsert(t, ctx, conn, "EMP-000001", "original title")

	if _, err := conn.ExecContext(ctx, "UPDATE notifications SET title = ? WHERE id = ?", "tampered title", id); err == nil {
		t.Fatal("expected UPDATE of title to be blocked by the notifications_read_only trigger")
	}

	if _, err := conn.ExecContext(ctx, "UPDATE notifications SET read_at = ? WHERE id = ?", time.Now().UTC(), id); err != nil {
		t.Fatalf("expected UPDATE of read_at to succeed, got %v", err)
	}
}

func mustInsert(t *testing.T, ctx context.Context, conn *sql.DB, recipient, title string) int64 {
	t.Helper()
	res, err := conn.ExecContext(ctx, `
		INSERT INTO notifications (recipient_employee_id, event_name, title, created_at)
		VALUES (?, ?, ?, ?)`, recipient, "test.direct.insert", title, time.Now().UTC())
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	return id
}
