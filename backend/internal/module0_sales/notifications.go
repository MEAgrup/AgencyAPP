package sales

// notifications.go — W1-08 wiring for the two M0 negotiation notification
// events (Phase 0 v2 §9 catalog, O15 canonical slugs). Sprint 0's
// notify.DefaultCatalog ships these entries with notYetWired placeholder
// resolvers precisely so the owning module can Replace them once it has real
// tables to query (S0-10 design note) — this file is that replacement.
//
// The EVENTS themselves are produced by the statemachine engine's Event
// overrides on the negotiation edges (machines.go / O15) and published only
// after the enclosing transaction commits (Engine.InTx) — nothing here emits;
// this file only resolves recipients. Titles are kept byte-identical to the
// catalog defaults (the copy shipped and reviewed with S0-10); only the
// Recipients resolvers change.

import (
	"context"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/notify"
)

// WireNegotiationNotifications replaces the placeholder resolvers of the two
// m0.negotiation.* catalog entries with real ones:
//
//   - m0.negotiation.pending_approval_submitted → the Superior(s): every
//     active employee in the submitting salesperson's division whose HRIS
//     (divisi, jabatan) maps to the lead_spv role (M0 §5 "Superior is
//     notified"; PERMISSIONS.md M0 approval = Sales Head/SPV);
//   - m0.negotiation.decision → the salesperson: the attempt's owner (M0 §5
//     Approve/Counter/Reject are decisions ON the salesperson's proposal).
//
// Call once at application bootstrap, after notify.NewCenter(DefaultCatalog).
func WireNegotiationNotifications(center *notify.Center) error {
	if err := center.Replace(notify.CatalogEntry{
		EventName:   "m0.negotiation.pending_approval_submitted",
		Module:      "M0",
		Description: "Negotiation `Pending Approval` submitted -> Superior (Sales Head/SPV)",
		Recipients:  resolveNegotiationSuperiors,
		Render:      negotiationRender("Negosiasi menunggu persetujuan"),
	}); err != nil {
		return err
	}
	return center.Replace(notify.CatalogEntry{
		EventName:   "m0.negotiation.decision",
		Module:      "M0",
		Description: "Negotiation decision (Approved / Revision Required / Rejected) -> Salesperson",
		Recipients:  resolveAttemptOwner,
		Render:      negotiationRender("Keputusan negosiasi"),
	})
}

// resolveNegotiationSuperiors resolves the Sales Head/SPV recipients for a
// pending-approval submission: active, present-in-sync employees of the
// attempt owner's division whose (divisi, jabatan) row in role_mappings is
// lead_spv. Uses the same mapping table authz resolves permissions from
// (S0-08), so a mapping change redirects notifications without redeploy.
func resolveNegotiationSuperiors(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
	// COLLATE utf8mb4_unicode_ci on the non-employees columns: the employees
	// mirror (0010) is utf8mb4_unicode_ci while prospect_attempts and
	// role_mappings use the schema default utf8mb4_general_ci — without the
	// explicit collation MySQL/MariaDB reject the joins ("illegal mix of
	// collations").
	rows, err := q.QueryContext(ctx,
		`SELECT es.employee_id
		 FROM prospect_attempts pa
		 JOIN employees own ON own.employee_id = pa.owner_employee_id COLLATE utf8mb4_unicode_ci
		 JOIN employees es ON es.divisi = own.divisi
		   AND es.status_aktif = 1 AND es.missing_from_sync = 0
		 JOIN role_mappings rm ON rm.divisi COLLATE utf8mb4_unicode_ci = es.divisi
		   AND rm.jabatan COLLATE utf8mb4_unicode_ci = es.jabatan
		 WHERE pa.prospect_id = ? AND rm.role = ?`,
		e.EntityID, string(authz.RoleLeadSPV))
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
	return out, rows.Err()
}

// resolveAttemptOwner resolves the submitting salesperson: the attempt's
// owner_employee_id. An unknown prospect id yields no recipients (defensive;
// the event is only ever emitted for a committed transition on a real row).
func resolveAttemptOwner(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
	var owner string
	err := q.QueryRowContext(ctx,
		`SELECT owner_employee_id FROM prospect_attempts WHERE prospect_id = ?`, e.EntityID).Scan(&owner)
	if err != nil {
		return nil, err
	}
	return []string{owner}, nil
}

// negotiationRender mirrors the catalog's default static render (title +
// per-entity deep link) so replacing the resolver does not change the copy.
func negotiationRender(title string) notify.RenderFunc {
	return func(e events.Event) (string, string, string) {
		deepLink := ""
		if e.EntityType != "" && e.EntityID != "" {
			deepLink = "/" + e.EntityType + "/" + e.EntityID
		}
		return title, "", deepLink
	}
}
