package leads

import (
	"context"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// AttemptCreator spawns a Prospect attempt (`PRSP-`) for a lead. Prospect
// attempts are owned by Module 0 (Sales), built in parallel; this module
// depends on them only through this interface (dependency injection), never on
// Module 0's tables. The signature is frozen by the W1-01 ticket.
type AttemptCreator interface {
	// CreateAttempt creates a Prospect attempt in the reference [New Lead]
	// state owned by ownerEmployeeID on leadID. The PRSP id is generated
	// INSIDE transaction q, so the attempt and the lead write commit/roll back
	// together. It returns the new PRSP id.
	CreateAttempt(ctx context.Context, q db.Queryer, leadID, ownerEmployeeID string, at time.Time) (string, error)
}
