// Package ident implements the house ID scheme PREFIX-YYYYMM-NNNN.
//
// Rules (CLAUDE.md convention 1 + S0-03):
//   - IDs are generated ONLY after mandatory-field validation passes.
//   - The sequence is allocated inside the SAME transaction as the entity
//     insert, so a rolled-back insert consumes no sequence number.
//   - Allocation is concurrency-safe via SELECT ... FOR UPDATE row locking.
//   - IDs are immutable and never reused.
package ident

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/tz"
)

// Next allocates the next ID for prefix in the YYYYMM bucket of now, using the
// supplied transaction.
//
// It uses a single atomic upsert that takes an exclusive row lock on the
// (prefix, period) counter, held until the transaction commits or rolls back.
// This guarantees:
//   - no gaps / no duplicates under concurrency (contenders serialize on the
//     row lock and each observes the committed counter),
//   - no consumption on rollback (a rolled-back increment is fully reverted, so
//     the number is reissued to the next committer).
//
// The LAST_INSERT_ID(expr) trick returns the freshly allocated number without a
// separate SELECT, avoiding the shared→exclusive lock upgrade that deadlocks a
// naive INSERT-IGNORE + SELECT ... FOR UPDATE approach.
func Next(ctx context.Context, tx *sql.Tx, prefix string, now time.Time) (string, error) {
	// Business-month bucket in WIB (Asia/Jakarta), not UTC — DECISIONS O20.
	// This is the single conversion point for every PREFIX-YYYYMM-NNNN caller,
	// so callers may pass any instant (time.Now(), a stored created_at, …).
	period := tz.Period(now)

	res, err := tx.ExecContext(ctx,
		`INSERT INTO id_sequences (prefix, period, next_n, created_by)
		 VALUES (?, ?, LAST_INSERT_ID(1), 'SYSTEM')
		 ON DUPLICATE KEY UPDATE next_n = LAST_INSERT_ID(next_n + 1)`,
		prefix, period)
	if err != nil {
		return "", fmt.Errorf("ident: allocate sequence: %w", err)
	}
	n, err := res.LastInsertId()
	if err != nil {
		return "", fmt.Errorf("ident: read sequence: %w", err)
	}

	return fmt.Sprintf("%s-%s-%04d", prefix, period, n), nil
}
