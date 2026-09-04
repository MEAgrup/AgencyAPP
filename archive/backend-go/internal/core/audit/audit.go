// Package audit implements the append-only audit log (S0-04). Immutability is
// enforced at the storage layer by MySQL BEFORE UPDATE / BEFORE DELETE triggers
// (see migrations). There is deliberately NO update or delete code path here.
package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Execer is satisfied by *sql.DB and *sql.Tx — audit writes normally happen
// inside the same transaction as the change they record.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Querier is satisfied by *sql.DB and *sql.Tx for reads.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// Entry is one immutable audit record.
type Entry struct {
	ID              int64           `json:"id"`
	EntityType      string          `json:"entity_type"`
	EntityID        string          `json:"entity_id"`
	ActorEmployeeID string          `json:"actor_employee_id"`
	Action          string          `json:"action"`
	BeforeJSON      json.RawMessage `json:"before_json,omitempty"`
	AfterJSON       json.RawMessage `json:"after_json,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
}

// Record is a request to append an audit entry. Actor is mandatory.
type Record struct {
	EntityType string
	EntityID   string
	Actor      string
	Action     string
	Before     any
	After      any
}

// ErrNoActor is returned when an audit write is attempted without an actor.
var ErrNoActor = errors.New("audit: every write requires an actor")

// Write appends one immutable audit entry. It never updates or deletes.
func Write(ctx context.Context, ex Execer, r Record) error {
	if r.Actor == "" {
		return ErrNoActor
	}
	beforeJSON, err := marshalNullable(r.Before)
	if err != nil {
		return fmt.Errorf("audit: marshal before: %w", err)
	}
	afterJSON, err := marshalNullable(r.After)
	if err != nil {
		return fmt.Errorf("audit: marshal after: %w", err)
	}
	_, err = ex.ExecContext(ctx,
		`INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.EntityType, r.EntityID, r.Actor, r.Action, beforeJSON, afterJSON, r.Actor)
	if err != nil {
		return fmt.Errorf("audit: insert: %w", err)
	}
	return nil
}

func marshalNullable(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// Filter selects audit entries for the read API.
type Filter struct {
	EntityType string
	EntityID   string
	Limit      int
}

// List returns audit entries, newest first, matching the filter.
func List(ctx context.Context, q Querier, f Filter) ([]Entry, error) {
	query := `SELECT id, entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_at
	          FROM audit_log WHERE 1=1`
	var args []any
	if f.EntityType != "" {
		query += " AND entity_type = ?"
		args = append(args, f.EntityType)
	}
	if f.EntityID != "" {
		query += " AND entity_id = ?"
		args = append(args, f.EntityID)
	}
	query += " ORDER BY id DESC"
	if f.Limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", f.Limit)
	}
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		var before, after sql.NullString
		if err := rows.Scan(&e.ID, &e.EntityType, &e.EntityID, &e.ActorEmployeeID, &e.Action, &before, &after, &e.CreatedAt); err != nil {
			return nil, err
		}
		if before.Valid {
			e.BeforeJSON = json.RawMessage(before.String)
		}
		if after.Valid {
			e.AfterJSON = json.RawMessage(after.String)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
