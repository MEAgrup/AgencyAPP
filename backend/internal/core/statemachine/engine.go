package statemachine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
)

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
}

// New builds an Engine. flags may be nil if the caller never uses flag APIs.
func New(store Store, flags FlagStore, logger audit.Logger, bus events.Bus) *Engine {
	return &Engine{store: store, flags: flags, audit: logger, bus: bus}
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
// atomically (within q) writes the new status, appends one immutable audit
// row, and publishes one event. On a blocked transition it returns a
// *BlockedError and changes nothing.
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
	e.bus.Publish(ctx, events.Event{
		Name:       name,
		EntityType: string(req.EntityType),
		EntityID:   req.EntityID,
		Actor:      req.Actor,
		At:         time.Now().UTC(),
		Payload:    payload,
	})
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
	e.bus.Publish(ctx, events.Event{
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
