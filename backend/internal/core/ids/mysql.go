package ids

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// ErrUnknownPrefix is returned when Next is called with a prefix that is not
// in the registry (docs/DATA_MODEL.md §1). No id is issued for it.
var ErrUnknownPrefix = errors.New("ids: unknown prefix (not in registry)")

// registry is the set of prefixes allowed by the house convention. Kept in
// sync with the exported Prefix* constants in contract.go.
var registry = map[string]struct{}{
	PrefixLead:           {},
	PrefixProspect:       {},
	PrefixCampaign:       {},
	PrefixClient:         {},
	PrefixTransaction:    {},
	PrefixInstallment:    {},
	PrefixService:        {},
	PrefixStrategy:       {},
	PrefixBrief:          {},
	PrefixAsset:          {},
	PrefixAdCampaign:     {},
	PrefixMetricEntry:    {},
	PrefixOptimization:   {},
	PrefixBooking:        {},
	PrefixCreatorPayment: {},
	PrefixLiveStream:     {},
	PrefixDependency:     {},
	PrefixComplaint:      {},
	PrefixHealthReport:   {},
	PrefixPerformance:    {},
}

// MySQL is the MySQL/MariaDB implementation of Generator.
//
// Concurrency strategy: a single atomic statement
//
//	INSERT INTO id_sequences (prefix, period, seq) VALUES (?, ?, LAST_INSERT_ID(1))
//	ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)
//
// increments the per-(prefix, period) counter and returns the new value via
// the connection's LAST_INSERT_ID. InnoDB takes an exclusive lock on the
// counter row for the duration of the caller's transaction, so parallel
// callers serialise (no duplicates, no gaps) and — because the increment is
// part of the caller's transaction — a rollback restores the counter, so a
// failed validation never permanently consumes a number. The statement runs
// on whatever Queryer the caller passes, i.e. inside their *sql.Tx.
type MySQL struct{}

// NewMySQL returns the MySQL/MariaDB Generator.
func NewMySQL() *MySQL { return &MySQL{} }

var _ Generator = (*MySQL)(nil)

const nextSeqStmt = "INSERT INTO id_sequences (prefix, period, seq) VALUES (?, ?, LAST_INSERT_ID(1)) " +
	"ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(seq + 1)"

// PeriodZone is the business timezone (WIB, UTC+7) in which the id period
// (YYYYMM) month boundary is evaluated, per docs/DECISIONS.md O10 (approved by
// Yohan 2026-07-10). A fixed-offset zone is used deliberately so id generation
// carries no tzdata dependency.
var PeriodZone = time.FixedZone("WIB", 7*3600)

// Next issues the next id for prefix at business time at, formatted as
// PREFIX-YYYYMM-NNNN. NNNN is zero-padded to a minimum of 4 digits; once the
// monthly sequence passes 9999 the numeric part simply grows (10000, ...),
// preserving ordering — it is never truncated or reset within the month.
//
// The period (YYYYMM) is derived from at converted into PeriodZone (WIB),
// so the month boundary is always evaluated in MEA's business timezone
// regardless of the location carried by the caller-supplied at
// (docs/DECISIONS.md O10).
func (MySQL) Next(ctx context.Context, q db.Queryer, prefix string, at time.Time) (string, error) {
	if _, ok := registry[prefix]; !ok {
		return "", fmt.Errorf("%w: %q", ErrUnknownPrefix, prefix)
	}
	period := at.In(PeriodZone).Format("200601")

	res, err := q.ExecContext(ctx, nextSeqStmt, prefix, period)
	if err != nil {
		return "", fmt.Errorf("ids: increment sequence for %s-%s: %w", prefix, period, err)
	}
	seq, err := res.LastInsertId()
	if err != nil {
		return "", fmt.Errorf("ids: read sequence for %s-%s: %w", prefix, period, err)
	}

	return fmt.Sprintf("%s-%s-%04d", prefix, period, seq), nil
}
