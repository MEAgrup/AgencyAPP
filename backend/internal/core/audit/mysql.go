package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// ErrMissingActor is returned by Append when Entry.Actor is empty. Every
// history write requires an actor (CLAUDE.md convention #3); the check runs
// before any DB access.
var ErrMissingActor = errors.New("audit: actor is required")

// defaultListLimit caps List when Filter.Limit is not set.
const defaultListLimit = 100

// MySQL is the MySQL/MariaDB implementation of Logger. Writes are append-only;
// there is deliberately no update or delete method, and the storage layer
// (BEFORE UPDATE / BEFORE DELETE triggers) rejects mutation even via raw SQL.
type MySQL struct{}

// NewMySQL returns the MySQL/MariaDB Logger.
func NewMySQL() *MySQL { return &MySQL{} }

var _ Logger = (*MySQL)(nil)

const appendStmt = "INSERT INTO audit_log " +
	"(entity_type, entity_id, actor, action, before_json, after_json, at) " +
	"VALUES (?, ?, ?, ?, ?, ?, ?)"

// Append writes one immutable history row and returns its auto-increment id.
// Actor is mandatory. If Entry.At is the zero time it defaults to the current
// UTC time so history rows always carry a usable timestamp.
func (MySQL) Append(ctx context.Context, q db.Queryer, e Entry) (int64, error) {
	if e.Actor == "" {
		return 0, ErrMissingActor
	}
	at := e.At
	if at.IsZero() {
		at = time.Now().UTC()
	}

	res, err := q.ExecContext(ctx, appendStmt,
		e.EntityType, e.EntityID, e.Actor, e.Action,
		nullJSON(e.Before), nullJSON(e.After), at,
	)
	if err != nil {
		return 0, fmt.Errorf("audit: append %s/%s: %w", e.EntityType, e.EntityID, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("audit: read inserted id: %w", err)
	}
	return id, nil
}

// List returns history rows matching f, ordered by id ascending (insertion /
// chronological order). All Filter fields are optional; an empty Filter
// returns the most-recent rows up to the default limit.
func (MySQL) List(ctx context.Context, q db.Queryer, f Filter) ([]Record, error) {
	var where []string
	var args []any
	if f.EntityType != "" {
		where = append(where, "entity_type = ?")
		args = append(args, f.EntityType)
	}
	if f.EntityID != "" {
		where = append(where, "entity_id = ?")
		args = append(args, f.EntityID)
	}
	if f.Actor != "" {
		where = append(where, "actor = ?")
		args = append(args, f.Actor)
	}
	if f.Action != "" {
		where = append(where, "action = ?")
		args = append(args, f.Action)
	}
	if !f.From.IsZero() {
		where = append(where, "at >= ?")
		args = append(args, f.From)
	}
	if !f.To.IsZero() {
		where = append(where, "at <= ?")
		args = append(args, f.To)
	}

	query := "SELECT id, entity_type, entity_id, actor, action, before_json, after_json, at FROM audit_log"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY id ASC"

	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	query += " LIMIT ?"
	args = append(args, limit)
	if f.Offset > 0 {
		query += " OFFSET ?"
		args = append(args, f.Offset)
	}

	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("audit: list: %w", err)
	}
	defer rows.Close()

	var out []Record
	for rows.Next() {
		var (
			r             Record
			before, after []byte
		)
		if err := rows.Scan(
			&r.ID, &r.EntityType, &r.EntityID, &r.Actor, &r.Action,
			&before, &after, &r.At,
		); err != nil {
			return nil, fmt.Errorf("audit: scan: %w", err)
		}
		if before != nil {
			r.Before = json.RawMessage(before)
		}
		if after != nil {
			r.After = json.RawMessage(after)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("audit: rows: %w", err)
	}
	return out, nil
}

// nullJSON maps an empty RawMessage to a SQL NULL and non-empty content to the
// bytes MySQL will validate/store in the JSON column.
func nullJSON(m json.RawMessage) any {
	if len(m) == 0 {
		return nil
	}
	return []byte(m)
}
