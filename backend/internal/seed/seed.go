// Package seed builds the CDPS demo/fixture dataset (S0-11) that the Sprint 0
// exit review (S0-12) and CI smoke test run against. It wires together the
// already-built core engines -- hris (employee sync), authz (role
// mapping/override admin + resolver), and msl (Master Service List) -- and
// populates them with the Alpha Digital worked example (Phase 0 OA-14) as far
// as the Sprint 0 schema allows.
//
// Everything here is IDEMPOTENT: running Seed twice leaves the database in the
// same state (no duplicate rows, no extra audit entries), so `make seed` and
// the CI smoke test can re-run freely.
//
// Structure: the fixture is a registry of ordered Steps. Sprint 0 registers
// its three steps (employees -> role mappings/overrides -> Master Service
// List) in sprint0.go's init(). Each later wave can add a file that Registers
// its own slice of the worked example (the client CLI-202605-0021, the
// TRX-202605-0021 transaction, its 3 services, etc.) once the owning module's
// tables exist -- Sprint 0 ships no client/lead/transaction tables, so none of
// that is seedable yet.
package seed

import (
	"context"
	"database/sql"
	"fmt"
)

// Step is one idempotent unit of the seed fixture. Run must be safe to invoke
// repeatedly against the same database.
type Step struct {
	Name string
	Run  func(ctx context.Context, conn *sql.DB) error
}

// registry is the ordered list of fixture steps. Populated via Register (see
// sprint0.go). Steps run in registration order.
var registry []Step

// Register appends a step to the fixture. Later waves call this from their own
// file's init() to extend the worked-example dataset without touching this
// file. Registration order is the execution order.
func Register(s Step) { registry = append(registry, s) }

// Steps returns a copy of the registered steps (for introspection/tests).
func Steps() []Step { return append([]Step(nil), registry...) }

// Seed runs every registered fixture step in order against conn. It is
// idempotent: a second run makes no changes. Migrations must already be
// applied (cmd/seed runs them first; testdb.New applies them).
func Seed(ctx context.Context, conn *sql.DB) error {
	for _, s := range registry {
		if err := s.Run(ctx, conn); err != nil {
			return fmt.Errorf("seed: step %q: %w", s.Name, err)
		}
	}
	return nil
}
