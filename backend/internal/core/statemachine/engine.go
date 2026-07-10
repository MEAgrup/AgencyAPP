package statemachine

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
)

// ActorSystem is the sentinel actor for system/batch/cascade-driven work. It
// is the ONLY actor permitted to take an Auto edge (see Transition.Auto); any
// other actor is blocked. Auto/batch jobs must set TransitionRequest.Actor to
// this exact string.
const ActorSystem = "system"

// ErrActorRequired is returned (before any side effect) when a transition or
// flag change is attempted without an actor. Actor is mandatory across CDPS
// (audit contract: every history row requires an actor).
var ErrActorRequired = errors.New("statemachine: actor wajib diisi")

// ErrUnknownEntity is returned when no machine is registered for the entity
// type in the request.
var ErrUnknownEntity = errors.New("statemachine: entity type tidak dikenal")

// ErrUnknownFlag is returned when a flag is not declared on the entity's
// machine.
var ErrUnknownFlag = errors.New("statemachine: flag tidak dikenal untuk entity ini")

// BlockedError is the typed error for a rejected transition (invalid from->to
// pair OR failed role check). It carries the exact Bahasa Indonesia message to
// surface to the user. When Transition returns a *BlockedError, NOTHING was
// changed: no Store write, no audit row, no event.
type BlockedError struct {
	Entity  EntityType
	From    Status
	To      Status
	Message string // byte-exact BI message (machine.BlockMsg)
	Reason  string // internal cause: "not_allowed" | "role_denied" (not shown to users)
}

func (e *BlockedError) Error() string { return e.Message }

// Reasons for BlockedError.Reason.
const (
	reasonNotAllowed = "not_allowed"
	reasonRoleDenied = "role_denied"
	reasonAutoOnly   = "auto_only" // Auto edge attempted by a non-system actor
)

// Store persists the authoritative status for an entity. In later waves the
// concrete implementation reads/writes a status column on each entity's own
// table via the supplied db.Queryer (which may be a *sql.Tx so the whole
// transition runs atomically with the caller's work). S0-05 ships no migration
// of its own.
type Store interface {
	// GetStatus loads the current status of an entity. It must error if the
	// entity does not exist (the engine only transitions existing rows;
	// creation into an Initial state is the owning module's job).
	GetStatus(ctx context.Context, q db.Queryer, entity EntityType, id string) (Status, error)
	// SetStatus writes the new status. Called only after validation passes.
	SetStatus(ctx context.Context, q db.Queryer, entity EntityType, id string, to Status) error
}

// FlagStore persists parallel flags (e.g. [Jatuh Tempo], [Bermasalah]) that
// live alongside — and independently of — an entity's status.
type FlagStore interface {
	SetFlag(ctx context.Context, q db.Queryer, entity EntityType, id string, flag Flag) error
	ClearFlag(ctx context.Context, q db.Queryer, entity EntityType, id string, flag Flag) error
}

// Engine is the transition engine. Construct with New.
type Engine struct {
	store Store
	flags FlagStore
	audit audit.Logger
	bus   events.Bus

	// pending buffers events produced inside a caller-owned *sql.Tx until that
	// tx commits, so a notification (published via the Center's own connection)
	// can never describe a transition the caller later rolled back. Keyed by
	// the *sql.Tx pointer; drained by PublishPending / discarded by DropPending
	// (both driven by InTx for the recommended entry point). mu guards it.
	mu      sync.Mutex
	pending map[*sql.Tx][]events.Event
}

// New builds an Engine. flags may be nil if the caller never uses flag APIs.
func New(store Store, flags FlagStore, logger audit.Logger, bus events.Bus) *Engine {
	return &Engine{store: store, flags: flags, audit: logger, bus: bus, pending: map[*sql.Tx][]events.Event{}}
}

// TransitionRequest describes one status change.
type TransitionRequest struct {
	EntityType EntityType
	EntityID   string
	To         Status
	Actor      string // HRIS employee_id, or "system" for auto/batch edges. Mandatory.
	ActorRoles []Role // CDPS roles held by the actor (for role-restricted edges)
	// Payload is merged into the published event's payload (optional). It never
	// affects validation.
	Payload map[string]any
}

// statusDoc is the JSON shape stored in audit before/after.
type statusDoc struct {
	Status Status `json:"status"`
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v) // statusDoc / map[string]any never fail to marshal
	return b
}

// Transition validates req against the entity's machine and, on success,
// writes the new status, appends one immutable audit row, and publishes one
// event. On a blocked transition it returns a *BlockedError and changes
// nothing.
//
// Transaction contract: q may be a *sql.DB or a *sql.Tx.
//   - *sql.DB: the status write, audit row and event all happen immediately;
//     the event is published on the bus synchronously before Transition
//     returns.
//   - *sql.Tx: the status write and audit row go through the tx (so they
//     commit/roll back atomically with the caller's work), but the event is
//     BUFFERED, not published, because notification fan-out (notify.Center)
//     writes via its own connection and must not observe a transition the
//     caller later rolls back. The caller MUST drain the buffer AFTER
//     committing (PublishPending) or discard it on rollback (DropPending).
//     Use Engine.InTx to get this right automatically -- it is the
//     recommended Wave-1 entry point.
func (e *Engine) Transition(ctx context.Context, q db.Queryer, req TransitionRequest) error {
	m, ok := machines[req.EntityType]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownEntity, req.EntityType)
	}
	if req.Actor == "" {
		return ErrActorRequired
	}

	from, err := e.store.GetStatus(ctx, q, req.EntityType, req.EntityID)
	if err != nil {
		return err
	}

	t := m.find(from, req.To)
	if t == nil {
		// Not in the table => blocked. Terminal states fall through here too
		// (they have no outgoing edges), which is exactly the desired "no
		// transition out of a terminal state" behaviour.
		return &BlockedError{Entity: req.EntityType, From: from, To: req.To, Message: m.BlockMsg, Reason: reasonNotAllowed}
	}
	// Auto edges are system/cascade-only: only the system actor may take them.
	// A human/role actor is blocked here with ZERO side effects.
	if t.Auto && req.Actor != ActorSystem {
		return &BlockedError{Entity: req.EntityType, From: from, To: req.To, Message: m.BlockMsg, Reason: reasonAutoOnly}
	}
	if len(t.Roles) > 0 && !hasAnyRole(req.ActorRoles, t.Roles) {
		return &BlockedError{Entity: req.EntityType, From: from, To: req.To, Message: m.BlockMsg, Reason: reasonRoleDenied}
	}

	// --- success path: persist, then log, then publish ---
	if err := e.store.SetStatus(ctx, q, req.EntityType, req.EntityID, req.To); err != nil {
		return err
	}
	if _, err := e.audit.Append(ctx, q, audit.Entry{
		EntityType: string(req.EntityType),
		EntityID:   req.EntityID,
		Actor:      req.Actor,
		Action:     "transition",
		Before:     mustJSON(statusDoc{Status: from}),
		After:      mustJSON(statusDoc{Status: req.To}),
		At:         time.Now().UTC(),
	}); err != nil {
		return err
	}

	name := m.EventName
	if t.Event != "" {
		name = t.Event
	}
	payload := map[string]any{"from": string(from), "to": string(req.To)}
	for k, v := range req.Payload {
		payload[k] = v
	}
	e.emit(ctx, q, events.Event{
		Name:       name,
		EntityType: string(req.EntityType),
		EntityID:   req.EntityID,
		Actor:      req.Actor,
		At:         time.Now().UTC(),
		Payload:    payload,
	})
	return nil
}

// emit publishes evt immediately when q is not a *sql.Tx, or buffers it
// against the tx (to be drained by PublishPending after commit) when it is.
func (e *Engine) emit(ctx context.Context, q db.Queryer, evt events.Event) {
	if tx, ok := q.(*sql.Tx); ok {
		e.mu.Lock()
		if e.pending == nil {
			e.pending = map[*sql.Tx][]events.Event{}
		}
		e.pending[tx] = append(e.pending[tx], evt)
		e.mu.Unlock()
		return
	}
	e.bus.Publish(ctx, evt)
}

// PublishPending publishes and clears every event buffered against tx. Call it
// AFTER the tx has committed successfully. It is safe to call for a tx that
// buffered nothing (no-op). InTx calls this for you.
func (e *Engine) PublishPending(ctx context.Context, tx *sql.Tx) {
	e.mu.Lock()
	evts := e.pending[tx]
	delete(e.pending, tx)
	e.mu.Unlock()
	for _, evt := range evts {
		e.bus.Publish(ctx, evt)
	}
}

// DropPending discards every event buffered against tx WITHOUT publishing.
// Call it when the tx rolls back (or its commit fails), so a rolled-back
// transition never produces a notification. InTx calls this for you.
func (e *Engine) DropPending(tx *sql.Tx) {
	e.mu.Lock()
	delete(e.pending, tx)
	e.mu.Unlock()
}

// InTx is the recommended entry point for a transactional transition. It
// begins a tx on conn, runs fn (which should call Transition/SetFlag with the
// supplied tx), and then:
//   - on fn error: rolls back and discards any buffered events (DropPending);
//   - on commit error: discards buffered events too;
//   - on success: commits, THEN publishes the buffered events (PublishPending).
//
// This guarantees notifications fire only for transitions that actually
// committed, and only after they are durable.
func (e *Engine) InTx(ctx context.Context, conn *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		e.DropPending(tx)
		return err
	}
	if err := tx.Commit(); err != nil {
		e.DropPending(tx)
		return err
	}
	e.PublishPending(ctx, tx)
	return nil
}

// FlagRequest describes setting or clearing a parallel flag.
type FlagRequest struct {
	EntityType EntityType
	EntityID   string
	Flag       Flag
	Actor      string // mandatory
}

// SetFlag raises a parallel flag on an entity, independent of its status. It is
// audited and publishes an event; it never runs status transition validation.
func (e *Engine) SetFlag(ctx context.Context, q db.Queryer, req FlagRequest) error {
	return e.applyFlag(ctx, q, req, true)
}

// ClearFlag lowers a parallel flag.
func (e *Engine) ClearFlag(ctx context.Context, q db.Queryer, req FlagRequest) error {
	return e.applyFlag(ctx, q, req, false)
}

func (e *Engine) applyFlag(ctx context.Context, q db.Queryer, req FlagRequest, set bool) error {
	m, ok := machines[req.EntityType]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownEntity, req.EntityType)
	}
	if req.Actor == "" {
		return ErrActorRequired
	}
	if !m.hasFlag(req.Flag) {
		return fmt.Errorf("%w: %q on %q", ErrUnknownFlag, req.Flag, req.EntityType)
	}
	if e.flags == nil {
		return errors.New("statemachine: no FlagStore configured")
	}

	action := "flag_clear"
	before, after := true, false
	if set {
		action, before, after = "flag_set", false, true
	}

	if set {
		if err := e.flags.SetFlag(ctx, q, req.EntityType, req.EntityID, req.Flag); err != nil {
			return err
		}
	} else {
		if err := e.flags.ClearFlag(ctx, q, req.EntityType, req.EntityID, req.Flag); err != nil {
			return err
		}
	}

	flagDoc := func(v bool) json.RawMessage {
		return mustJSON(map[string]any{"flag": string(req.Flag), "set": v})
	}
	if _, err := e.audit.Append(ctx, q, audit.Entry{
		EntityType: string(req.EntityType),
		EntityID:   req.EntityID,
		Actor:      req.Actor,
		Action:     action,
		Before:     flagDoc(before),
		After:      flagDoc(after),
		At:         time.Now().UTC(),
	}); err != nil {
		return err
	}
	e.emit(ctx, q, events.Event{
		Name:       string(req.EntityType) + "." + action,
		EntityType: string(req.EntityType),
		EntityID:   req.EntityID,
		Actor:      req.Actor,
		At:         time.Now().UTC(),
		Payload:    map[string]any{"flag": string(req.Flag), "set": set},
	})
	return nil
}

func hasAnyRole(have, want []Role) bool {
	for _, w := range want {
		for _, h := range have {
			if h == w {
				return true
			}
		}
	}
	return false
}
