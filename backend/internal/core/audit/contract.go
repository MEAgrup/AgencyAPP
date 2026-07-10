// Package audit is the append-only history engine (CLAUDE.md convention #3).
// There is NO update or delete path — rows are immutable at the storage
// layer, and every duration metric in CDPS derives from these timestamps.
package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

type Entry struct {
	EntityType string          // e.g. "prospect", "transaction"
	EntityID   string          // business id, e.g. "PRSP-202607-0001"
	Actor      string          // HRIS employee_id; "system" for batch jobs
	Action     string          // e.g. "transition", "create", "correction"
	Before     json.RawMessage // nil on create
	After      json.RawMessage
	At         time.Time
}

type Record struct {
	ID int64
	Entry
}

type Filter struct {
	EntityType string
	EntityID   string
	Actor      string
	Action     string
	From, To   time.Time
	Limit      int
	Offset     int
}

type Logger interface {
	// Append writes one immutable history row. Actor is mandatory.
	Append(ctx context.Context, q db.Queryer, e Entry) (int64, error)
	List(ctx context.Context, q db.Queryer, f Filter) ([]Record, error)
}
