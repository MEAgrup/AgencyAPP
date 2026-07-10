package notify

import (
	"context"
	"fmt"
	"sync"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
)

// RecipientResolver turns a fired event into the list of employee IDs who
// should be notified. It is handed the same Queryer the Center was told to
// use for the current fan-out (see Center.Subscribe), so a resolver that
// needs to look something up (e.g. "who is the SPV of division X") can run
// a query -- but it must not invent business rules that are not already
// specified by the owning module's PRD. If the tables/columns a resolver
// needs don't exist yet, use notYetWired instead of guessing (see below).
type RecipientResolver func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error)

// RenderFunc turns a fired event into the human-facing notification content.
type RenderFunc func(e events.Event) (title, body, deepLink string)

// CatalogEntry is one row of the Phase 0 v2 §9 event catalog.
type CatalogEntry struct {
	// EventName must match events.Event.Name exactly for this entry to fire.
	EventName string
	// Module is the PRD module tag this event belongs to (e.g. "M0"), for
	// traceability back to Phase 0 v2 §9.
	Module string
	// Description is the exact (or lightly paraphrased, see comments below)
	// prose from the §9 table row this entry encodes.
	Description string
	// Recipients resolves who gets notified.
	Recipients RecipientResolver
	// Render produces the notification's title/body/deep-link.
	Render RenderFunc
}

func (e CatalogEntry) validate() error {
	if e.EventName == "" {
		return fmt.Errorf("notify: catalog entry missing EventName (module %s)", e.Module)
	}
	if e.Recipients == nil {
		return fmt.Errorf("notify: catalog entry %q missing Recipients resolver", e.EventName)
	}
	if e.Render == nil {
		return fmt.Errorf("notify: catalog entry %q missing Render func", e.EventName)
	}
	return nil
}

// Catalog is the set of events the notification Center knows how to fan out.
// Publishing an event whose Name is not registered here is a silent no-op
// (see Center.Subscribe) -- the catalog is the single source of truth for
// "which events produce notifications."
type Catalog struct {
	mu      sync.RWMutex
	entries map[string]CatalogEntry
}

// NewCatalog returns an empty catalog. Prefer DefaultCatalog for production
// wiring; NewCatalog is for tests that want to register only synthetic
// entries.
func NewCatalog() *Catalog {
	return &Catalog{entries: map[string]CatalogEntry{}}
}

// Register adds entry to the catalog. It errors if entry is incomplete or
// if EventName is already registered (catalog entries are append-only by
// construction -- there is no Unregister).
func (c *Catalog) Register(entry CatalogEntry) error {
	if err := entry.validate(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[entry.EventName]; exists {
		return fmt.Errorf("notify: event %q already registered", entry.EventName)
	}
	c.entries[entry.EventName] = entry
	return nil
}

// Lookup returns the catalog entry for name, if any.
func (c *Catalog) Lookup(name string) (CatalogEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.entries[name]
	return entry, ok
}

// notYetWired is the RecipientResolver for catalog entries whose recipient
// rule needs data owned by a module that has not been built yet (Sprint 0
// ships only the core engines -- M0/M5/M6/M9/M10/M11/M12/M13/M14 tables do
// not exist). Per the S0-10 ticket instructions this MUST NOT be replaced
// with invented recipient logic (e.g. guessing at a division->SPV lookup);
// it is a loud, explicit placeholder until the owning module lands and can
// supply a real resolver.
func notYetWired(reason string) RecipientResolver {
	return func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
		return nil, fmt.Errorf("notify: recipient resolver for event %q not yet wired: %s", e.Name, reason)
	}
}

// staticRender builds a RenderFunc from a fixed title template and the
// event's own entity fields. It's a generic default suitable for every
// catalog entry below because none of them have a real recipient resolver
// yet either -- once a module wires a real resolver it can also supply a
// richer Render if the generic one isn't enough.
func staticRender(title string) RenderFunc {
	return func(e events.Event) (t, body, deepLink string) {
		body = title
		if e.Actor != "" {
			body = fmt.Sprintf("%s (actor: %s)", title, e.Actor)
		}
		if e.EntityType != "" && e.EntityID != "" {
			deepLink = "/" + e.EntityType + "/" + e.EntityID
		}
		return title, body, deepLink
	}
}

// DefaultCatalog returns the v1 event catalog per Phase 0 v2 §9's table.
//
// IMPORTANT / ambiguity notes (also called out in the S0-10 report -- these
// are judgment calls made because §9 gives prose, not machine-readable
// event names, and should be confirmed / logged in docs/DECISIONS.md by
// whoever owns that file, since this package is not allowed to edit it):
//
//  1. §9 gives human-language event descriptions, not literal event-name
//     strings. The EventName values below (e.g. "m0.negotiation.decision")
//     are this package's invented slugs, chosen to be stable identifiers
//     that the eventual M0/M5/M6/M9/M10/M11/M12/M13/M14 producers can adopt
//     verbatim. They are NOT quoted from the PRD.
//  2. The §9 row "Installment due (H-3) and overdue" bundles two distinct
//     triggers (a reminder vs. a `[Jatuh Tempo]` breach) with the same
//     recipients. This catalog splits it into two entries
//     (m0_m5.installment.due_h3 / m0_m5.installment.overdue) since they are
//     different point-in-time events with different copy; the recipient
//     rule is identical for both.
//  3. Every single entry's Recipients resolver is a notYetWired placeholder:
//     Sprint 0 ships only core engines (ids, audit, statemachine, hris,
//     authz, msl, notify) -- none of M0/M5/M6/M9/M10/M11/M12/M13/M14 exist
//     yet, so there is no table/entity this package can honestly query to
//     resolve "Superior (Sales Head/SPV)", "AM + SPV Account", "KOL Lead",
//     etc. Do not fill these in from this package; the owning module should
//     call Catalog.Register again with a real resolver once it has the data
//     (Catalog has no in-place "replace" -- see Center for a re-registration
//     helper note).
func DefaultCatalog() *Catalog {
	c := NewCatalog()
	for _, entry := range defaultEntries() {
		if err := c.Register(entry); err != nil {
			// Entries below are static and controlled by this package; a
			// failure here is a programming error, not a runtime condition.
			panic(err)
		}
	}
	return c
}

func defaultEntries() []CatalogEntry {
	return []CatalogEntry{
		{
			EventName:   "m0.negotiation.pending_approval_submitted",
			Module:      "M0",
			Description: "Negotiation `Pending Approval` submitted -> Superior (Sales Head/SPV)",
			Recipients:  notYetWired("needs M0 negotiation entity + the salesperson's division to resolve their Sales Head/SPV (also depends on authz role_mappings, S0-08)"),
			Render:      staticRender("Negosiasi menunggu persetujuan"),
		},
		{
			EventName:   "m0.negotiation.decision",
			Module:      "M0",
			Description: "Negotiation decision (Approved / Revision Required / Rejected) -> Salesperson",
			Recipients:  notYetWired("needs M0 negotiation entity to resolve the submitting salesperson"),
			Render:      staticRender("Keputusan negosiasi"),
		},
		{
			EventName:   "m0_m5.installment.due_h3",
			Module:      "M0/M5",
			Description: "Installment due in 3 days -> Sales PIC (collection) + Finance (verification), Module 0 OD-3",
			Recipients:  notYetWired("needs M0/M5 installment schedule entity to resolve Sales PIC and Finance staff"),
			Render:      staticRender("Cicilan jatuh tempo H-3"),
		},
		{
			EventName:   "m0_m5.installment.overdue",
			Module:      "M0/M5",
			Description: "Installment `[Jatuh Tempo]` (overdue) -> Sales PIC (collection) + Finance (verification), Module 0 OD-3",
			Recipients:  notYetWired("needs M0/M5 installment schedule entity to resolve Sales PIC and Finance staff"),
			Render:      staticRender("Cicilan [Jatuh Tempo]"),
		},
		{
			EventName:   "m5.contract.not_received_7d",
			Module:      "M5",
			Description: "Contract not received 7 days after Account routing -> Finance + SPV",
			Recipients:  notYetWired("needs M5 contract-routing entity to resolve Finance and the routing SPV"),
			Render:      staticRender("Kontrak belum diterima 7 hari setelah routing"),
		},
		{
			EventName:   "m6.complaint.logged",
			Module:      "M6",
			Description: "Complaint logged (any door) -> AM + SPV Account",
			Recipients:  notYetWired("needs M6 complaint entity to resolve the assigned AM and SPV Account"),
			Render:      staticRender("Komplain baru tercatat"),
		},
		{
			EventName:   "m9.qc_or_booking.escalated",
			Module:      "M9",
			Description: "QC Failed / Booking `[Escalated]` -> KOL Lead",
			Recipients:  notYetWired("needs M9 KOL booking/QC entity to resolve the KOL Lead"),
			Render:      staticRender("Booking [Escalated]"),
		},
		{
			EventName:   "m10.session.discrepancy_flagged",
			Module:      "M10",
			Description: "Session `[Discrepancy Flagged]` -> SPV Account, real-time (M10-OA-3)",
			Recipients:  notYetWired("needs M10 live-stream session entity to resolve SPV Account"),
			Render:      staticRender("Sesi [Discrepancy Flagged]"),
		},
		{
			EventName:   "m11.dependency.blocking_satisfied",
			Module:      "M11",
			Description: "Blocking Dependency Satisfied -> Target Brief PIC",
			Recipients:  notYetWired("needs M11 PM Kanban dependency entity to resolve the target brief's PIC"),
			Render:      staticRender("Dependency terpenuhi"),
		},
		{
			EventName:   "m12.block_request.submitted",
			Module:      "M12",
			Description: "Block request submitted -> SPV/Lead (approval queue, Module 15)",
			Recipients:  notYetWired("needs M12 task-execution block-request entity to resolve the approving SPV/Lead"),
			Render:      staticRender("Permintaan block diajukan"),
		},
		{
			EventName:   "m12.block_request.decision",
			Module:      "M12",
			Description: "Block request approved/rejected -> Requester",
			Recipients:  notYetWired("needs M12 task-execution block-request entity to resolve the original requester"),
			Render:      staticRender("Keputusan permintaan block"),
		},
		{
			EventName:   "m12.revision_count.quality_flag",
			Module:      "M12",
			Description: "Revision Count >= 3 (Quality flag) -> Team Leader/SPV",
			Recipients:  notYetWired("needs M12 task-execution revision-count entity to resolve the Team Leader/SPV"),
			Render:      staticRender("Revision Count >= 3 (Quality flag)"),
		},
		{
			EventName:   "m13.client_band.dropped",
			Module:      "M13",
			Description: "Client band drop (e.g. Healthy -> Watch) -> SPV",
			Recipients:  notYetWired("needs M13 client health score entity to resolve the client's SPV"),
			Render:      staticRender("Band kesehatan klien turun"),
		},
		{
			EventName:   "m14.performance_score.published",
			Module:      "M14",
			Description: "Monthly Performance Score published -> Each staff member",
			Recipients:  notYetWired("needs M14 team performance entity (and the HRIS employee roster) to resolve every staff member"),
			Render:      staticRender("Skor performa bulanan dipublikasikan"),
		},
	}
}
