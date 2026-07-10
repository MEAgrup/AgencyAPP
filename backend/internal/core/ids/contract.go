// Package ids issues business identifiers in the house format
// PREFIX-YYYYMM-NNNN (CLAUDE.md convention #1). IDs are generated ONLY after
// mandatory-field validation passes, inside the same transaction as the
// entity insert, and are never reused.
package ids

import (
	"context"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// Prefix registry — docs/DATA_MODEL.md §1. SVC per DECISIONS.md O1 proposal.
const (
	PrefixLead           = "LEAD"
	PrefixProspect       = "PRSP"
	PrefixCampaign       = "CMP"
	PrefixClient         = "CLI"
	PrefixTransaction    = "TRX"
	PrefixInstallment    = "INST"
	PrefixService        = "SVC"
	PrefixStrategy       = "STR"
	PrefixBrief          = "BRF"
	PrefixAsset          = "AST"
	PrefixAdCampaign     = "ADC"
	PrefixMetricEntry    = "MTR"
	PrefixOptimization   = "OPT"
	PrefixBooking        = "BKG"
	PrefixCreatorPayment = "CPR"
	PrefixLiveStream     = "LSS"
	PrefixDependency     = "DEP"
	PrefixComplaint      = "CPL"
	PrefixHealthReport   = "CHR"
	PrefixPerformance    = "PERF"
)

// Generator issues the next id for a prefix at the given business time.
// Implementations must be concurrency-safe: parallel calls never produce
// duplicates, and a rolled-back caller transaction never leaves an orphan
// id in use (a consumed-but-rolled-back sequence number may leave a gap in
// the monthly sequence only if the storage design documents it — see the
// implementation package for the chosen strategy).
type Generator interface {
	Next(ctx context.Context, q db.Queryer, prefix string, at time.Time) (string, error)
}
