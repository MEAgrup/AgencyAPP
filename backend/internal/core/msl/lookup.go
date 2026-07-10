package msl

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// EffectiveAt returns the version of entryID effective at time at -- the
// latest version whose effective_from is <= at. This is what deal closing
// locks onto (Phase 0 §10 point 2): money-critical, so the boundary is
// inclusive (a version effective exactly at `at` counts) and a date before
// the entry's first version returns ErrNotFound rather than an error.
func EffectiveAt(ctx context.Context, q db.Queryer, entryID int64, at time.Time) (*ServiceVersion, error) {
	var v ServiceVersion
	err := q.QueryRowContext(ctx,
		`SELECT id, entry_id, version, name, standard_price, commission_rule, active, effective_from, created_at, created_by
		 FROM service_entry_versions
		 WHERE entry_id = ? AND effective_from <= ?
		 ORDER BY effective_from DESC, version DESC
		 LIMIT 1`,
		entryID, at,
	).Scan(&v.ID, &v.EntryID, &v.Version, &v.Name, &v.StandardPrice, &v.CommissionRule, &v.Active, &v.EffectiveFrom, &v.CreatedAt, &v.CreatedBy)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}
