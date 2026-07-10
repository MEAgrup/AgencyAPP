// Package notify is the in-app notification center (S0-10, CLAUDE.md
// convention #8, Phase 0 v2 §9). It is deliberately channel-agnostic: v1
// only ever writes rows to the notifications table (in-app inbox), but the
// Catalog/Center split means an email/WhatsApp channel could subscribe to
// the same catalog later without touching event producers.
//
// A notification is DERIVED from a fired events.Event -- it is never a
// substitute for the audit log, and it is never deletable: there is no
// delete method on Center, and the notifications table has a BEFORE DELETE
// trigger (migration 0026) that blocks DELETE at the storage layer too, in
// case a future caller reaches for raw SQL instead of this package.
package notify

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
)

// ErrNotFound is returned by MarkRead when the notification ID does not
// exist.
var ErrNotFound = errors.New("notify: notification not found")

// ErrForbidden is returned by MarkRead when the caller is not the
// notification's recipient. Only the recipient may mark their own
// notification read.
var ErrForbidden = errors.New("notify: notification does not belong to this employee")

// Notification is one row of a recipient's inbox.
type Notification struct {
	ID                  int64
	RecipientEmployeeID string
	EventName           string
	EntityType          string
	EntityID            string
	Title               string
	Body                string
	DeepLink            string
	PayloadJSON         []byte // raw JSON, nil if the event carried no payload
	ReadAt              *time.Time
	CreatedAt           time.Time
}

// IsRead reports whether the notification has been marked read.
func (n Notification) IsRead() bool { return n.ReadAt != nil }

// Center fans cataloged events out into notification rows and serves the
// per-employee inbox.
type Center struct {
	catalog        *Catalog
	onResolveError func(e events.Event, err error)
}

// CenterOption configures a Center at construction time.
type CenterOption func(*Center)

// WithResolveErrorHook overrides how Center reports a Recipients resolver
// error during fan-out (default: log.Printf). events.Bus handlers have no
// error return, so a resolver failure (e.g. a notYetWired placeholder
// firing for real) can't propagate to the publisher -- this hook is the
// only way to observe it, which is exactly what the S0-10 AC tests use it
// for.
func WithResolveErrorHook(f func(e events.Event, err error)) CenterOption {
	return func(c *Center) { c.onResolveError = f }
}

// NewCenter builds a Center around catalog. Pass notify.DefaultCatalog()
// for production wiring, or notify.NewCatalog() plus Register calls in
// tests.
func NewCenter(catalog *Catalog, opts ...CenterOption) *Center {
	c := &Center{
		catalog: catalog,
		onResolveError: func(e events.Event, err error) {
			log.Printf("notify: recipient resolution failed for event %q: %v", e.Name, err)
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Register adds entry to the Center's catalog. See Catalog.Register.
func (c *Center) Register(entry CatalogEntry) error {
	return c.catalog.Register(entry)
}

// Replace overwrites an already-registered catalog entry in place. See
// Catalog.Replace -- this is how an owning module swaps a DefaultCatalog
// notYetWired placeholder for a real resolver once its tables exist.
func (c *Center) Replace(entry CatalogEntry) error {
	return c.catalog.Replace(entry)
}

// Subscribe wires the Center into bus: every published event is checked
// against the catalog, and cataloged events fan out into one notification
// row per resolved recipient using q for all writes. Uncataloged events are
// ignored silently (this is the intended behavior, not an error condition
// -- most events in the system are not notification-worthy).
//
// q is captured for the lifetime of the subscription because events.Handler
// has no per-call way to receive one; callers that need per-request
// transactions for other engines are unaffected since notification writes
// are independent, best-effort side effects of the event, not part of the
// entity's own transaction.
func (c *Center) Subscribe(bus events.Bus, q db.Queryer) {
	bus.Subscribe("*", func(ctx context.Context, e events.Event) {
		c.handle(ctx, q, e)
	})
}

func (c *Center) handle(ctx context.Context, q db.Queryer, e events.Event) {
	entry, ok := c.catalog.Lookup(e.Name)
	if !ok {
		return // uncataloged event: silent no-op by design
	}

	recipients, err := entry.Recipients(ctx, q, e)
	if err != nil {
		c.onResolveError(e, err)
		return
	}
	if len(recipients) == 0 {
		return
	}

	title, body, deepLink := entry.Render(e)

	var payloadJSON []byte
	if len(e.Payload) > 0 {
		payloadJSON, err = json.Marshal(e.Payload)
		if err != nil {
			c.onResolveError(e, fmt.Errorf("marshal payload for event %q: %w", e.Name, err))
			return
		}
	}

	createdAt := e.At
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	seen := make(map[string]bool, len(recipients))
	for _, recipient := range recipients {
		if recipient == "" || seen[recipient] {
			continue
		}
		seen[recipient] = true

		_, err := q.ExecContext(ctx, `
			INSERT INTO notifications
				(recipient_employee_id, event_name, entity_type, entity_id, title, body, deep_link, payload_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			recipient, e.Name, nullIfEmpty(e.EntityType), nullIfEmpty(e.EntityID), title,
			nullIfEmpty(body), nullIfEmpty(deepLink), payloadJSON, createdAt,
		)
		if err != nil {
			c.onResolveError(e, fmt.Errorf("insert notification for recipient %q: %w", recipient, err))
		}
	}
}

// Inbox returns employeeID's notifications, most recent first, optionally
// filtered to unread only, paginated by limit/offset.
func (c *Center) Inbox(ctx context.Context, q db.Queryer, employeeID string, onlyUnread bool, limit, offset int) ([]Notification, error) {
	query := `
		SELECT id, recipient_employee_id, event_name, entity_type, entity_id,
		       title, body, deep_link, payload_json, read_at, created_at
		FROM notifications
		WHERE recipient_employee_id = ?`
	args := []any{employeeID}
	if onlyUnread {
		query += " AND read_at IS NULL"
	}
	query += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Notification
	for rows.Next() {
		var n Notification
		var entityType, entityID, body, deepLink sql.NullString
		var payloadJSON []byte
		var readAt sql.NullTime
		if err := rows.Scan(&n.ID, &n.RecipientEmployeeID, &n.EventName, &entityType, &entityID,
			&n.Title, &body, &deepLink, &payloadJSON, &readAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.EntityType = entityType.String
		n.EntityID = entityID.String
		n.Body = body.String
		n.DeepLink = deepLink.String
		n.PayloadJSON = payloadJSON
		if readAt.Valid {
			t := readAt.Time
			n.ReadAt = &t
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// UnreadCount returns employeeID's unread notification count (the bell
// badge number).
func (c *Center) UnreadCount(ctx context.Context, q db.Queryer, employeeID string) (int, error) {
	var n int
	err := q.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id = ? AND read_at IS NULL`,
		employeeID,
	).Scan(&n)
	return n, err
}

// MarkRead marks notificationID read on behalf of employeeID. Only the
// notification's own recipient may mark it read (ErrForbidden otherwise);
// an unknown ID returns ErrNotFound. Marking an already-read notification
// read again is a no-op success (idempotent). There is intentionally no
// mark-unread and no delete: read/unread is the only mutable bit
// (CLAUDE.md convention #8), enforced again at the storage layer by the
// notifications_read_only trigger (migration 0026).
func (c *Center) MarkRead(ctx context.Context, q db.Queryer, employeeID string, notificationID int64) error {
	var recipient string
	var readAt sql.NullTime
	err := q.QueryRowContext(ctx,
		`SELECT recipient_employee_id, read_at FROM notifications WHERE id = ?`,
		notificationID,
	).Scan(&recipient, &readAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if recipient != employeeID {
		return ErrForbidden
	}
	if readAt.Valid {
		return nil // already read; idempotent no-op
	}
	_, err = q.ExecContext(ctx,
		`UPDATE notifications SET read_at = ? WHERE id = ?`,
		time.Now().UTC(), notificationID,
	)
	return err
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
