package module13_health

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Division constants relevant to M13 (an Account-owned view, §Rule 11).
const (
	AccountDivision = "Account"
)

// Service is the Module 13 persistence + scoring surface. Catalog is optional:
// when nil, the band-drop emission (Rule 12) is a no-op — mirroring the nil-guard
// used by module7_creative.ScanHoursReminders and module11_board so the pure
// scoring paths are unit-testable without the notification wiring.
type Service struct {
	DB      *sql.DB
	Catalog *notification.Catalog
}

// Sentinel errors surfaced to the HTTP layer. They reuse the shared house BI
// strings (CLAUDE.md §5) — no new entity-specific validation string is minted.
// The one genuinely new string is the scan-authorisation message (W1-09 / W3-CAT-1
// precedent), proposed for orchestrator sign-off; see ErrScanForbidden.
var (
	// ErrForbidden: the actor's role has no M13 access at all (e.g. a
	// non-Account execution staffer). Reuses the shared access-denied string.
	ErrForbidden = errors.New("[anda tidak memiliki akses ke data ini]")
	// ErrNotFound: the Client (or snapshot) does not exist OR is not visible to
	// the actor — invisible-but-existing is reported as not-found so an AM cannot
	// probe clients outside their book (same pattern as module4_client).
	ErrNotFound = errors.New("[data tidak ditemukan]")
	// ErrScanForbidden: the actor may not trigger the monthly snapshot sweep. NEW
	// BI string (W1-09 precedent, mirrors module7_creative.ErrHoursReminderScanForbidden),
	// listed in the cluster report for orchestrator approval.
	ErrScanForbidden = errors.New("[anda tidak memiliki akses untuk menjalankan pemindaian skor kesehatan klien]")
)

// canView reports whether the actor may see a given Client's health data
// (M13 §2 Rule 11): AM = own assigned clients; Account lead/SPV = division-wide;
// OD = read-only everywhere; Director = full. Every other role is denied. The
// gate mirrors module4_client.visibility / module12_task.canViewTask for the
// Account side so an AM never sees a client outside their book.
func canView(actor permission.Actor, ownerAM string) bool {
	if actor.Role.Director || actor.Role.OD { // Director full; OD read-only everywhere
		return true
	}
	if actor.Role.Division == AccountDivision {
		if actor.Role.Level == permission.LevelLead { // Account lead/SPV: division-wide
			return true
		}
		return actor.EmployeeID == ownerAM // Account staff (AM): own assigned clients only
	}
	return false
}

// canScope reports whether the actor has ANY M13 read scope (used to reject a
// non-Account role before a per-client lookup). Account/OD/Director only.
func canScope(actor permission.Actor) bool {
	if actor.Role.Director || actor.Role.OD {
		return true
	}
	return actor.Role.Division == AccountDivision
}

// canRunScan authorises the on-demand snapshot sweep endpoint: Account (any
// level) or Director. Mirrors module5_finance.canRunScan (Finance-or-Director)
// and module7_creative.canRunHoursReminderScan (Creative-or-Director) — the
// division that OWNS the dashboard triggers its own sweep; a pure-OD account is
// read-only and cannot run it.
func canRunScan(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == AccountDivision && !a.Role.OD
}

// canToggleROAS authorises setting the per-Client ROAS Inclusion Toggle (Rule 13
// / §5.4): AM/SPV (Account staff or lead) or Director. OD is read-only. An AM may
// only toggle a client in their own book — the per-client ownership check is done
// by the caller via canView after loading the owner.
func canToggleROAS(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	if a.Role.OD {
		return false
	}
	return a.Role.Division == AccountDivision
}

// clientOwnerAM loads a client's current assigned AM (M6 §3, migration 0020) and
// reports existence. Returns ErrNotFound when the client row is absent.
func clientOwnerAM(ctx context.Context, q rowQuerier, clientID string) (ownerAM string, err error) {
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT assigned_am_id FROM clients WHERE id = ?`, clientID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return owner.String, nil
}

// rowQuerier is satisfied by *sql.DB and *sql.Tx — the gather + read helpers work
// against either, so the live preview (on *sql.DB) and the batch sweep (inside a
// *sql.Tx) share one code path.
type rowQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
