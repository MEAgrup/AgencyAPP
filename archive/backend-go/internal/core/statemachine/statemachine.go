// Package statemachine is the declarative transition engine (S0-05).
//
// House rules enforced here:
//   - A status field is ONLY ever set through Transition — never a raw UPDATE.
//   - Invalid transitions are blocked server-side with the machine's configured
//     Bahasa Indonesia message (default "[transisi status tidak diizinkan]") and
//     change nothing.
//   - Role-restricted transitions (e.g. brief_task [Blocked] = SPV/Lead-only)
//     are enforced; OD (read-only) can never drive a transition.
//   - Every transition appends an immutable audit row and emits an event hook
//     used by the notification center — all inside the caller's transaction.
package statemachine

import (
	"context"
	"database/sql"
	"fmt"
	"sort"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// DefaultBlockMessage is the fallback BI message for an unlisted transition.
const DefaultBlockMessage = "[transisi status tidak diizinkan]"

// RoleDeniedMessage is returned when a transition is role-restricted and the
// actor lacks the required authority.
const RoleDeniedMessage = "[anda tidak memiliki akses untuk melakukan transisi ini]"

// rule describes one allowed edge.
type rule struct {
	requireLead bool   // SPV/Lead-only transition
	message     string // optional custom block message when this edge is rejected by a gate
}

// Machine is one entity's declarative lifecycle.
type Machine struct {
	Name         string
	Initial      string
	Flags        []string        // parallel flags (e.g. [Jatuh Tempo], [Bermasalah])
	AutoComputed bool            // dependency: status auto-computed, no manual transitions
	BlockMessage string          // BI message for invalid transitions
	terminal     map[string]bool // terminal states
	transitions  map[string]map[string]rule
}

// IsTerminal reports whether s is a terminal state of the machine.
func (m *Machine) IsTerminal(s string) bool { return m.terminal[s] }

// AllowedFrom returns the sorted list of target states reachable from `from`.
func (m *Machine) AllowedFrom(from string) []string {
	var out []string
	for to := range m.transitions[from] {
		out = append(out, to)
	}
	sort.Strings(out)
	return out
}

// Edge is one configured transition (introspection/testing).
type Edge struct {
	From        string
	To          string
	RequireLead bool
}

// Edges returns all configured edges of the machine (sorted for determinism).
func (m *Machine) Edges() []Edge {
	var out []Edge
	for from, tos := range m.transitions {
		for to, r := range tos {
			out = append(out, Edge{From: from, To: to, RequireLead: r.requireLead})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].From != out[j].From {
			return out[i].From < out[j].From
		}
		return out[i].To < out[j].To
	})
	return out
}

// Machines returns all registered machines (introspection/testing).
func (e *Engine) Machines() []*Machine {
	out := make([]*Machine, 0, len(e.machines))
	for _, m := range e.machines {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// BlockedError is an invalid-transition error carrying the BI message.
type BlockedError struct{ Message string }

func (e *BlockedError) Error() string { return e.Message }

// RoleError is a role-restriction denial carrying the BI message.
type RoleError struct{ Message string }

func (e *RoleError) Error() string { return e.Message }

// Event is emitted after a successful transition. Tx is the caller's
// transaction so downstream effects (notifications) stay atomic.
type Event struct {
	Ctx        context.Context
	Tx         *sql.Tx
	Machine    string
	EntityType string
	EntityID   string
	From       string
	To         string
	Actor      permission.Actor
}

// EventHook receives transition events. A non-nil error rolls back the whole
// transition.
type EventHook func(Event) error

// Engine holds machine configs and an optional event hook.
type Engine struct {
	machines map[string]*Machine
	hook     EventHook
}

// New returns an engine loaded with the canonical machine configuration
// transcribed from docs/STATE_MACHINES.md.
func New() *Engine {
	return &Engine{machines: defaultMachines()}
}

// SetHook registers the event hook (e.g. the notification emitter).
func (e *Engine) SetHook(h EventHook) { e.hook = h }

// Machine returns a registered machine by name.
func (e *Engine) Machine(name string) (*Machine, bool) {
	m, ok := e.machines[name]
	return m, ok
}

// Request describes a transition to attempt.
type Request struct {
	Machine      string
	EntityType   string // for the audit row
	Table        string // storage table
	IDColumn     string // primary-key column (default "id")
	StatusColumn string // status column (default "status")
	EntityID     string
	To           string
	Actor        permission.Actor
}

// Result reports the applied transition.
type Result struct {
	From string
	To   string
}

// Transition validates, applies and audits a status change within tx. It is
// the ONLY path that writes a status column.
func (e *Engine) Transition(ctx context.Context, tx *sql.Tx, req Request) (Result, error) {
	m, ok := e.machines[req.Machine]
	if !ok {
		return Result{}, fmt.Errorf("statemachine: unknown machine %q", req.Machine)
	}
	if m.AutoComputed {
		return Result{}, fmt.Errorf("statemachine: %q status is auto-computed; manual transitions are not allowed", req.Machine)
	}
	idCol := req.IDColumn
	if idCol == "" {
		idCol = "id"
	}
	statusCol := req.StatusColumn
	if statusCol == "" {
		statusCol = "status"
	}

	// Lock the entity row and read the authoritative current status.
	var from string
	q := fmt.Sprintf("SELECT %s FROM %s WHERE %s = ? FOR UPDATE", statusCol, req.Table, idCol)
	if err := tx.QueryRowContext(ctx, q, req.EntityID).Scan(&from); err != nil {
		if err == sql.ErrNoRows {
			return Result{}, fmt.Errorf("statemachine: entity %s not found", req.EntityID)
		}
		return Result{}, err
	}

	tos, ok := m.transitions[from]
	if !ok {
		return Result{}, &BlockedError{Message: m.BlockMessage}
	}
	r, ok := tos[req.To]
	if !ok {
		return Result{}, &BlockedError{Message: m.BlockMessage}
	}

	// Role-restricted edge: SPV/Lead (or Director) only. OD never writes.
	if r.requireLead {
		a := req.Actor
		if !(a.Role.Director || a.Role.Level == permission.LevelLead) {
			return Result{}, &RoleError{Message: RoleDeniedMessage}
		}
	}

	// Apply the status change (the only place this happens).
	u := fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", req.Table, statusCol, idCol)
	if _, err := tx.ExecContext(ctx, u, req.To, req.EntityID); err != nil {
		return Result{}, err
	}

	// Immutable audit row.
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: req.EntityType,
		EntityID:   req.EntityID,
		Actor:      req.Actor.EmployeeID,
		Action:     fmt.Sprintf("transition:%s->%s", from, req.To),
		Before:     map[string]string{"status": from},
		After:      map[string]string{"status": req.To},
	}); err != nil {
		return Result{}, err
	}

	// Emit event (notifications) inside the same transaction.
	if e.hook != nil {
		if err := e.hook(Event{
			Ctx: ctx, Tx: tx,
			Machine: req.Machine, EntityType: req.EntityType, EntityID: req.EntityID,
			From: from, To: req.To, Actor: req.Actor,
		}); err != nil {
			return Result{}, err
		}
	}

	return Result{From: from, To: req.To}, nil
}
