// Package notification implements the in-app notification center (S0-10).
//
// The event catalog is Phase 0 v2 §9 (14 events; the 13 Phase 0 events plus the
// M1 dedup-v2 co-pursuit event). Notifications are derived
// from audit/transition events, are per-user read/unread, and are NEVER
// deletable — there is no delete code path here and none in the migrations
// (a BEFORE DELETE trigger backs this at the storage layer).
package notification

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// DB is satisfied by *sql.DB and *sql.Tx.
type DB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// EventType identifies a cataloged event.
type EventType string

// The 14 cataloged events (Phase 0 v2 §9 + M1 dedup-v2 co-pursuit).
const (
	EvNegotiationPendingApproval EventType = "m0.negotiation.pending_approval" // -> Sales Head/SPV
	EvNegotiationDecision        EventType = "m0.negotiation.decision"         // -> Salesperson
	EvInstallmentDue             EventType = "m0m5.installment.due"            // -> Sales PIC + Finance
	EvContractNotReceived        EventType = "m5.contract.not_received"        // -> Finance + SPV
	EvComplaintLogged            EventType = "m6.complaint.logged"             // -> AM + SPV Account
	EvKOLQCFailedOrEscalated     EventType = "m9.kol.qc_failed_or_escalated"   // -> KOL Lead
	EvSessionDiscrepancyFlagged  EventType = "m10.session.discrepancy_flagged" // -> SPV Account
	EvDependencySatisfied        EventType = "m11.dependency.satisfied"        // -> Target Brief PIC
	EvBlockRequestSubmitted      EventType = "m12.block_request.submitted"     // -> SPV/Lead
	EvBlockRequestDecided        EventType = "m12.block_request.decided"       // -> Requester
	EvRevisionCountFlag          EventType = "m12.revision_count.flag"         // -> Team Leader/SPV
	EvClientBandDrop             EventType = "m13.client.band_drop"            // -> SPV
	EvPerformancePublished       EventType = "m14.performance.published"       // -> Each staff
	EvLeadCoPursuit              EventType = "m1.lead.co_pursuit"              // -> co-pursuit owners + registrant
)

// Emission is one notification-generating occurrence.
type Emission struct {
	Event              EventType
	EntityType         string
	EntityID           string
	Actor              string   // actor employee id
	DeepLink           string   // optional; defaulted from entity if empty
	Division           string   // CDPS division for role-based recipient resolution
	ExplicitRecipients []string // used when the caller already knows recipients
	NotifyActor        bool     // include the actor as a recipient (default: exclude)
}

// Resolver turns an emission into a set of recipient employee ids.
type Resolver func(ctx context.Context, db DB, em Emission) ([]string, error)

type entry struct {
	Description string
	Resolve     Resolver
}

// Catalog holds the registered events + their recipient resolvers.
type Catalog struct {
	entries map[EventType]entry
}

// NewCatalog returns the catalog with all 14 events registered.
func NewCatalog() *Catalog {
	c := &Catalog{entries: map[EventType]entry{}}

	// Recipients not yet fully modeled resolve via role/division rules for now.
	c.entries[EvNegotiationPendingApproval] = entry{"Negotiation Pending Approval submitted", leadsOfDivision}
	c.entries[EvNegotiationDecision] = entry{"Negotiation decision", explicit}
	c.entries[EvInstallmentDue] = entry{"Installment due/overdue", explicitOrLeads}
	c.entries[EvContractNotReceived] = entry{"Contract not received 7 days after routing", explicitOrLeads}
	c.entries[EvComplaintLogged] = entry{"Complaint logged (any door)", explicitOrLeads}
	c.entries[EvKOLQCFailedOrEscalated] = entry{"QC Failed / Booking Escalated", leadsOfDivision}
	c.entries[EvSessionDiscrepancyFlagged] = entry{"Session Discrepancy Flagged", leadsOfDivision}
	c.entries[EvDependencySatisfied] = entry{"Blocking Dependency Satisfied", explicit}
	c.entries[EvBlockRequestSubmitted] = entry{"Block request submitted", leadsOfDivision}
	c.entries[EvBlockRequestDecided] = entry{"Block request approved/rejected", explicit}
	c.entries[EvRevisionCountFlag] = entry{"Revision Count >= 3 (Quality flag)", leadsOfDivision}
	c.entries[EvClientBandDrop] = entry{"Client band drop", leadsOfDivision}
	c.entries[EvPerformancePublished] = entry{"Monthly Performance Score published", explicit}
	c.entries[EvLeadCoPursuit] = entry{"Lead dikerjakan lebih dari satu sales", explicit}

	return c
}

// Events returns all registered event types (for tests / introspection).
func (c *Catalog) Events() []EventType {
	out := make([]EventType, 0, len(c.entries))
	for e := range c.entries {
		out = append(out, e)
	}
	return out
}

// Emit resolves recipients and inserts one notification per recipient. It
// returns the recipient ids actually notified. All work happens on db (pass the
// caller's *sql.Tx to keep it atomic with the triggering change).
func (c *Catalog) Emit(ctx context.Context, db DB, em Emission) ([]string, error) {
	e, ok := c.entries[em.Event]
	if !ok {
		return nil, fmt.Errorf("notification: unknown event %q", em.Event)
	}
	recips, err := e.Resolve(ctx, db, em)
	if err != nil {
		return nil, err
	}
	deepLink := em.DeepLink
	if deepLink == "" {
		deepLink = fmt.Sprintf("/%s/%s", em.EntityType, em.EntityID)
	}
	seen := map[string]bool{}
	var notified []string
	for _, r := range recips {
		if r == "" || seen[r] {
			continue
		}
		if r == em.Actor && !em.NotifyActor {
			continue
		}
		seen[r] = true
		if _, err := db.ExecContext(ctx,
			`INSERT INTO notifications (recipient_employee_id, event_type, entity_type, entity_id, actor_employee_id, deep_link, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			r, string(em.Event), em.EntityType, em.EntityID, em.Actor, deepLink, em.Actor); err != nil {
			return nil, err
		}
		notified = append(notified, r)
	}
	return notified, nil
}

// ---- resolvers ----

// leadsOfDivision returns active employees mapped to (division, level=lead).
func leadsOfDivision(ctx context.Context, db DB, em Emission) ([]string, error) {
	if em.Division == "" {
		return em.ExplicitRecipients, nil
	}
	rows, err := db.QueryContext(ctx,
		`SELECT e.employee_id
		   FROM employees e
		   JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
		  WHERE rm.division = ? AND rm.level = 'lead' AND e.status_aktif = 1`,
		em.Division)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	out = append(out, em.ExplicitRecipients...)
	return out, rows.Err()
}

// explicit returns exactly the caller-provided recipients.
func explicit(_ context.Context, _ DB, em Emission) ([]string, error) {
	return em.ExplicitRecipients, nil
}

// explicitOrLeads unions explicit recipients with the division leads.
func explicitOrLeads(ctx context.Context, db DB, em Emission) ([]string, error) {
	leads, err := leadsOfDivision(ctx, db, em)
	if err != nil {
		return nil, err
	}
	return append(leads, em.ExplicitRecipients...), nil
}

// ---- inbox ----

// Notification is one inbox row.
type Notification struct {
	ID         int64      `json:"id"`
	EventType  string     `json:"event_type"`
	EntityType string     `json:"entity_type"`
	EntityID   string     `json:"entity_id"`
	DeepLink   string     `json:"deep_link"`
	Actor      string     `json:"actor"`
	CreatedAt  time.Time  `json:"created_at"`
	ReadAt     *time.Time `json:"read_at"`
}

// List returns a recipient's notifications, newest first.
func List(ctx context.Context, db DB, recipient string, unreadOnly bool) ([]Notification, error) {
	q := `SELECT id, event_type, entity_type, entity_id, deep_link, actor_employee_id, created_at, read_at
	        FROM notifications WHERE recipient_employee_id = ?`
	if unreadOnly {
		q += " AND read_at IS NULL"
	}
	q += " ORDER BY id DESC"
	rows, err := db.QueryContext(ctx, q, recipient)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		var readAt sql.NullTime
		if err := rows.Scan(&n.ID, &n.EventType, &n.EntityType, &n.EntityID, &n.DeepLink, &n.Actor, &n.CreatedAt, &readAt); err != nil {
			return nil, err
		}
		if readAt.Valid {
			t := readAt.Time
			n.ReadAt = &t
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// UnreadCount returns the recipient's unread notification count.
func UnreadCount(ctx context.Context, db DB, recipient string) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id = ? AND read_at IS NULL`, recipient)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var n int
	if rows.Next() {
		if err := rows.Scan(&n); err != nil {
			return 0, err
		}
	}
	return n, rows.Err()
}

// MarkRead marks one notification read for the recipient (idempotent). This is
// the ONLY state change allowed on a notification — there is no delete path.
func MarkRead(ctx context.Context, db DB, id int64, recipient string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE notifications SET read_at = NOW() WHERE id = ? AND recipient_employee_id = ? AND read_at IS NULL`,
		id, recipient)
	return err
}
