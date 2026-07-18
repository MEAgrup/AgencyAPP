package module13_health

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// ROASToggle is the read view of a Client's ROAS Inclusion Toggle (Rule 13 /
// §5.4): the explicit override (nil = following the default), the two Ads-service
// signals, and the resolved effective inclusion the scorer will use this run.
type ROASToggle struct {
	ClientID  string `json:"client_id"`
	Override  *bool  `json:"override"`   // nil = no override (follow default)
	HasAds    bool   `json:"has_ads"`    // any Ads campaign exists (else structurally N/A)
	HasActive bool   `json:"has_active"` // an [Active] campaign exists (the default when no override)
	Effective bool   `json:"effective"`  // resolved inclusion intent (false when structurally N/A)
}

// GetROASToggle returns a Client's ROAS toggle state. Read-gated by Rule 11.
func (s *Service) GetROASToggle(ctx context.Context, actor permission.Actor, clientID string) (ROASToggle, error) {
	if err := s.assertCanView(ctx, actor, clientID); err != nil {
		return ROASToggle{}, err
	}
	return s.readToggle(ctx, s.DB, clientID)
}

// SetROASToggle sets (override non-nil) or clears (override nil → back to default)
// the per-Client ROAS toggle (Rule 13 / §5.4). Write-gated: AM/SPV or Director
// (OD read-only); an AM may only toggle a client in its own book. The change is
// appended to the immutable audit_log (before→after) — no stored history column
// (mirrors the M6-OA-1 override precedent). Setting the toggle does NOT recompute
// or mutate any existing snapshot (those are immutable) — it affects the next run.
func (s *Service) SetROASToggle(ctx context.Context, actor permission.Actor, clientID string, override *bool) (ROASToggle, error) {
	if !canToggleROAS(actor) {
		return ROASToggle{}, ErrForbidden
	}
	ownerAM, err := clientOwnerAM(ctx, s.DB, clientID)
	if err != nil {
		return ROASToggle{}, err
	}
	if !canView(actor, ownerAM) { // AM own-client / lead division-wide / Director full
		return ROASToggle{}, ErrNotFound
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return ROASToggle{}, err
	}
	defer tx.Rollback()

	var before sql.NullBool
	if err := tx.QueryRowContext(ctx,
		`SELECT roas_health_included_override FROM clients WHERE id = ? FOR UPDATE`, clientID).Scan(&before); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ROASToggle{}, ErrNotFound
		}
		return ROASToggle{}, err
	}

	var arg any
	if override != nil {
		arg = *override
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE clients SET roas_health_included_override = ? WHERE id = ?`, arg, clientID); err != nil {
		return ROASToggle{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID,
		Action: "roas_health_toggle_set",
		Before: map[string]any{"override": nullBoolPtr(before)},
		After:  map[string]any{"override": override},
	}); err != nil {
		return ROASToggle{}, err
	}

	tg, err := s.readToggle(ctx, tx, clientID)
	if err != nil {
		return ROASToggle{}, err
	}
	if err := tx.Commit(); err != nil {
		return ROASToggle{}, err
	}
	return tg, nil
}

// readToggle resolves a Client's toggle against the current Ads-service presence.
func (s *Service) readToggle(ctx context.Context, q rowQuerier, clientID string) (ROASToggle, error) {
	var override sql.NullBool
	err := q.QueryRowContext(ctx,
		`SELECT roas_health_included_override FROM clients WHERE id = ?`, clientID).Scan(&override)
	if errors.Is(err, sql.ErrNoRows) {
		return ROASToggle{}, ErrNotFound
	}
	if err != nil {
		return ROASToggle{}, err
	}
	hasAny, hasActive, err := adsServicePresence(ctx, q, clientID)
	if err != nil {
		return ROASToggle{}, err
	}
	tg := ROASToggle{ClientID: clientID, Override: nullBoolPtr(override), HasAds: hasAny, HasActive: hasActive}
	// Effective inclusion mirrors roasCandidate: structurally N/A without any Ads.
	if hasAny {
		if override.Valid {
			tg.Effective = override.Bool
		} else {
			tg.Effective = hasActive
		}
	}
	return tg, nil
}

func nullBoolPtr(v sql.NullBool) *bool {
	if !v.Valid {
		return nil
	}
	b := v.Bool
	return &b
}
