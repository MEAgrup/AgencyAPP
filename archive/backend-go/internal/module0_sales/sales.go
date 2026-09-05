// Package module0_sales carries the M0 sales lifecycle: attempt progression
// (Contacted → Qualified), the Qualified Form (commission pinned from the
// Master Service List), negotiation versioning + superior approval, and the
// Closing Form that births the Client / Transaction / Service / Installment
// rows of the frozen 0002 money-path schema.
//
// Ported from build stream A (W1-05..09) onto foundation B (canonical 0002
// schema + core engines). Domain logic follows CDPS_Module0_Sales.md; storage
// is remapped to the 0002 tables. commission.go and allocation.go are the
// frozen money contracts and are used as-is.
package module0_sales

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// SalesDivision owns prospect attempts (M0 §9.1).
const SalesDivision = "Sales"

// Prospect-attempt statuses (verbatim; the prospect_attempt machine in
// core/statemachine/config.go governs the legal moves).
const (
	StatusNewLead        = "New Lead"
	StatusContacted      = "Contacted"
	StatusQualified      = "Qualified"
	StatusNotQualified   = "Not Qualified"
	StatusNegPending     = "Negotiation - Pending Approval"
	StatusNegAutoApprove = "Negotiation - Auto Approved"
	StatusNegApproved    = "Negotiation - Approved"
	StatusNegRevision    = "Negotiation - Revision Required"
	StatusNegRejected    = "Negotiation - Rejected"
	StatusClosedSuccess  = "Closed-Success"
	StatusClosedLost     = "Closed-Lost"
	StatusClosedKalah    = "[Closed - Kalah Kompetisi]"
)

// WinResolverFunc fires M1 §6 rule 5 win resolution INSIDE the closing
// transaction. It carries no leads types so module0_sales never imports
// module1_leads (the leads package's own W1-03 test imports module0_sales; a
// reverse production import would form a cycle). The wiring layer binds it to
// module1_leads.Service.ResolveWin.
type WinResolverFunc func(ctx context.Context, tx *sql.Tx, leadID, winningAttemptID, winnerEmployeeID string, now time.Time) error

// Service is the M0 orchestrator over the 0002 tables.
type Service struct {
	DB      *sql.DB
	Engine  *statemachine.Engine
	Catalog *notification.Catalog
	Win     WinResolverFunc // may be nil (no-op) — bound by the wiring layer
}

// ErrIncomplete is the generic mandatory-field gate (Phase 0 §5 default).
var ErrIncomplete = errors.New(IncompleteMessage)

// ErrNotFound is returned when an attempt/entity lookup finds nothing.
var ErrNotFound = errors.New("module0_sales: not found")

// msgDenied is the canonical BI access-denial string (shared with the
// transition engine and M4/M5 finance).
const msgDenied = statemachine.RoleDeniedMessage

// blockedError carries a verbatim BI message for a blocked action.
type blockedError struct{ msg string }

func (e *blockedError) Error() string { return e.msg }

// attemptInfo is the loaded prospect attempt + its lead linkage.
type attemptInfo struct {
	id             string
	leadID         string
	ownerID        string
	status         string
	originDivision string
	originCampaign sql.NullString
}

// loadAttempt reads an attempt joined to its lead. Uses FOR UPDATE when inTx so
// concurrent progression on the same attempt serialises.
func loadAttempt(ctx context.Context, q rowQuerier, attemptID string, forUpdate bool) (attemptInfo, error) {
	sfx := ""
	if forUpdate {
		sfx = " FOR UPDATE"
	}
	var a attemptInfo
	err := q.QueryRowContext(ctx,
		`SELECT pa.id, pa.lead_id, pa.owner_employee_id, pa.status, l.origin_division, l.origin_campaign_id
		   FROM prospect_attempts pa JOIN leads l ON l.id = pa.lead_id
		  WHERE pa.id = ?`+sfx, attemptID).
		Scan(&a.id, &a.leadID, &a.ownerID, &a.status, &a.originDivision, &a.originCampaign)
	if err == sql.ErrNoRows {
		return attemptInfo{}, ErrNotFound
	}
	return a, err
}

// rowQuerier is satisfied by both *sql.DB and *sql.Tx.
type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// canWriteAttempt applies the M0 §9.1 matrix: Director everywhere; Sales Lead
// division-wide; Sales staff own attempts only; OD (read-only) never writes.
func canWriteAttempt(actor permission.Actor, ownerID string) bool {
	if actor.Role.Director {
		return true
	}
	if actor.Role.Division != SalesDivision {
		return false
	}
	if actor.Role.Level == permission.LevelLead {
		return true
	}
	return actor.Role.Level == permission.LevelStaff && actor.EmployeeID == ownerID
}

// transition drives the prospect_attempt machine within tx.
func (s *Service) transition(ctx context.Context, tx *sql.Tx, attemptID, to string, actor permission.Actor) error {
	_, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine:    statemachine.MProspectAttempt,
		EntityType: "prospect_attempt",
		Table:      "prospect_attempts",
		EntityID:   attemptID,
		To:         to,
		Actor:      actor,
	})
	return err
}
