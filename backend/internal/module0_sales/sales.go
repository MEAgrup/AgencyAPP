// Package sales implements CDPS Module 0 (Sales) — Wave 1 ticket W1-05,
// "Attempt lifecycle" (docs/prd/CDPS Module0 Sales.md §2-4, §7;
// docs/STATE_MACHINES.md §1; docs/backlog/WAVE1 BACKLOG.md).
//
// It owns the Prospect attempt entity (`PRSP-YYYYMM-NNNN`, M1 §9.3): a
// salesperson's working copy of a Module 1 Lead record. Every status change
// goes through internal/core/statemachine.Engine — this package never writes
// the `status` column by any other path (CLAUDE.md convention #2), and every
// transition is therefore audited immutably by the engine itself.
//
// Scope explicitly OUT of this ticket (left to the tickets named below,
// consumed as separate calls against the same Attempts type):
//   - Qualified Lead Form field validation/lock/auto-Estimasi-Komisi (W1-06).
//     QualifyFromForm performs ONLY the status transition; W1-06 owns
//     everything upstream of calling it.
//   - Negotiation Form / approval workflow specifics (W1-07/08) and the
//     Closing Form (W1-09) — their status transitions are reachable through
//     the generic UpdateStatus/SystemTransition API here (so this ticket's
//     AC — every §1 transition tested through this package's API, up to
//     Closed-Success) but the business rules around them (allocation Σ=100%,
//     negotiation versioning, service selection, ID generation for
//     CLI-/TRX-/SVC-) are NOT implemented here.
//   - Not-Qualified Reason taxonomy enforcement (W1-04): the reason is
//     accepted and stored if given, never validated against the closed list.
package sales

import (
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// DivisiSales is the division name used for permission checks (M0 §7.1).
// Kept as this package's own constant (rather than importing msl.DivisiSales)
// so module0_sales has no compile-time dependency on the Master Service List
// package; the literal is the same house-convention division name.
const DivisiSales = "Sales"

// ValidationError carries the exact Bahasa Indonesia message required by
// CLAUDE.md convention #5.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func validationErr() error { return &ValidationError{Message: msg.DataTidakLengkap} }

// DirectQualifyDeniedError is returned by UpdateStatus when the caller
// attempts To=Qualified directly through the generic status-update API. Per
// M0 §4: "Qualified" is reachable ONLY via a successful Qualified Lead Form
// submission (QualifyFromForm, consumed exclusively by ticket W1-06).
// UpdateStatus rejects the request before the engine is ever consulted, so
// nothing is written, audited, or transitioned — matching the "blocked
// transition changes nothing" house rule even though the engine's own
// Contacted->Qualified edge carries no role restriction (it is a form-gate,
// not a role gate).
type DirectQualifyDeniedError struct{}

func (DirectQualifyDeniedError) Error() string { return msg.TransisiTidakDiizinkan }

// ErrNotFound is returned when a prospect attempt id does not exist.
var ErrNotFound = errors.New("sales: prospect attempt not found")

// Attempt is the read-side view of one prospect_attempts row (M1 §9.3).
type Attempt struct {
	ProspectID         string
	LeadID             string
	OwnerEmployeeID    string
	Status             statemachine.Status
	NotQualifiedReason *string
	ContactActionType  *string
	LastStatusAt       time.Time
	CreatedAt          time.Time
	CreatedBy          string
}

// Attempts is the package's store+service type — the "sales" package's public
// surface. Construct with NewAttempts.
type Attempts struct {
	engine  *statemachine.Engine
	checker authz.Checker
	auditLg audit.Logger
	idgen   ids.Generator
}

// NewAttempts wires the Prospect attempt statemachine.Engine over the
// prospect_attempts table with the given core dependencies. bus is the
// events.Bus notifications/derived-field recompute subscribe to (S0-10); pass
// the process-wide bus in production, a fresh events.NewInMemoryBus() in
// tests that don't care about fan-out.
func NewAttempts(checker authz.Checker, logger audit.Logger, idgen ids.Generator, bus events.Bus) *Attempts {
	return &Attempts{
		engine:  statemachine.New(prospectStatusStore{}, nil, logger, bus),
		checker: checker,
		auditLg: logger,
		idgen:   idgen,
	}
}

// readDenied returns the typed authz denial for an unauthenticated/unmapped
// identity on a read path (mirrors internal/core/msl's pattern so callers can
// errors.Is(err, authz.ErrDenied) uniformly across packages).
func readDenied(actor authz.Identity) error {
	return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "unmapped identity has no read access to prospect attempts"}
}

// toStatemachineRoles adapts authz roles to the statemachine engine's Role
// type (a plain string alias) for role-restricted edges (e.g. negotiation
// approval, Sales Head/SPV-only).
func toStatemachineRoles(roles []authz.Role) []statemachine.Role {
	out := make([]statemachine.Role, 0, len(roles))
	for _, r := range roles {
		out = append(out, statemachine.Role(r))
	}
	return out
}

// requireWrite enforces M0 §7.1: Staff may write only their own attempts;
// Head/SPV Sales write division-wide; Director full; OD is read-only (denied
// here even if layered on the same account — authz.MatrixChecker never grants
// ActionWrite from RoleOD).
func (s *Attempts) requireWrite(actor authz.Identity, ownerEmployeeID string) error {
	return s.checker.Check(actor, authz.Request{Action: authz.ActionWrite, Division: DivisiSales, OwnerEmployeeID: ownerEmployeeID})
}

// requireRead enforces M0 §7.1 read access: Staff own-only, Head/SPV
// division-wide, OD read-only everywhere, Director full.
func (s *Attempts) requireRead(actor authz.Identity, ownerEmployeeID string) error {
	return s.checker.Check(actor, authz.Request{Action: authz.ActionRead, Division: DivisiSales, OwnerEmployeeID: ownerEmployeeID})
}
