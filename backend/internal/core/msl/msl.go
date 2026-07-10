// Package msl is the Master Service List (Phase 0 §10 / DECISIONS.md
// M0 OD-2 / S0-09). The list (service name, standard price, standard
// commission rule, active flag) drives every auto-computed Estimasi Nilai
// Transaksi and Perhitungan Komisi in Module 0.
//
// Ownership: Sales division. Entries are added/edited only by Sales
// Head/SPV (authz.RoleLeadSPV, division "Sales") or Director -- never by an
// individual salesperson. Every write is versioned (never updated in
// place) and appended to the audit log, so a closed deal can permanently
// reference the exact price/commission version in effect at its closing
// date; historical commissions never shift when the master list changes.
package msl

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
)

// DivisiSales is the owning division for Master Service List writes
// (Phase 0 §10 point 1 / DECISIONS.md M0 OD-2).
const DivisiSales = "Sales"

// ServiceEntry is the current-state header row (service_entries).
type ServiceEntry struct {
	ID        int64
	Name      string
	Active    bool
	CreatedAt time.Time
	CreatedBy string
}

// ServiceVersion is one immutable snapshot (service_entry_versions). Every
// write to an entry -- price, commission rule, name, or active flag --
// produces a new ServiceVersion; existing versions are never updated.
type ServiceVersion struct {
	ID             int64
	EntryID        int64
	Version        int
	Name           string
	StandardPrice  string // decimal literal, e.g. "1500000.00" -- never a float
	CommissionRule string // JSON string, PRD "standard commission rule"
	Active         bool
	EffectiveFrom  time.Time
	CreatedAt      time.Time
	CreatedBy      string
}

// ValidationError carries the exact Bahasa Indonesia message required by
// CLAUDE.md convention #5. No MSL-specific PRD message exists for
// mandatory-field failures here, so the documented default is used.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func validationErr() error { return &ValidationError{Message: msg.DataTidakLengkap} }

// ErrNotFound is returned when a lookup (by entry id, or EffectiveAt with no
// version effective at the requested date) finds nothing.
var ErrNotFound = errors.New("msl: not found")

var decimalPattern = regexp.MustCompile(`^\d+(\.\d{1,2})?$`)

// Store is the write-side Master Service List API. All writes go through
// Checker first (Sales lead_spv or Director only) and append an audit row
// via the audit.Logger contract.
type Store struct {
	checker authz.Checker
	audit   audit.Logger
}

// NewStore constructs a Store.
func NewStore(checker authz.Checker, logger audit.Logger) *Store {
	return &Store{checker: checker, audit: logger}
}

func (s *Store) requireSalesWrite(actor authz.Identity) error {
	return s.checker.Check(actor, authz.Request{Action: authz.ActionWrite, Division: DivisiSales})
}

// readDenied returns the typed authz denial for an unauthenticated/unmapped
// identity on the read path, so callers can errors.Is(err, authz.ErrDenied)
// exactly as they do for write denials (rather than string-matching a
// mandatory-field validation message that never applied to reads).
func readDenied(actor authz.Identity) error {
	return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "unmapped identity has no read access to the Master Service List"}
}

// CreateInput is the payload for CreateEntry; all fields are mandatory.
type CreateInput struct {
	Name           string
	StandardPrice  string // decimal literal, e.g. "1500000.00"
	CommissionRule string // JSON string
	EffectiveFrom  time.Time
}

func (in CreateInput) validate() error {
	if in.Name == "" || in.StandardPrice == "" || in.CommissionRule == "" || in.EffectiveFrom.IsZero() {
		return validationErr()
	}
	if !decimalPattern.MatchString(in.StandardPrice) {
		return validationErr()
	}
	if !json.Valid([]byte(in.CommissionRule)) {
		return validationErr()
	}
	return nil
}

// CreateEntry adds a new service to the Master Service List as version 1.
func (s *Store) CreateEntry(ctx context.Context, conn *sql.DB, actor authz.Identity, in CreateInput) (*ServiceEntry, error) {
	if err := s.requireSalesWrite(actor); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}

	var entry ServiceEntry
	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		res, err := tx.ExecContext(ctx,
			`INSERT INTO service_entries (name, active, created_at, created_by) VALUES (?, 1, ?, ?)`,
			in.Name, now, actor.EmployeeID,
		)
		if err != nil {
			return err
		}
		entryID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		version := ServiceVersion{
			EntryID: entryID, Version: 1, Name: in.Name, StandardPrice: in.StandardPrice,
			CommissionRule: in.CommissionRule, Active: true, EffectiveFrom: in.EffectiveFrom,
			CreatedAt: now, CreatedBy: actor.EmployeeID,
		}
		if err := insertVersion(ctx, tx, &version); err != nil {
			return err
		}

		after, _ := json.Marshal(version)
		if _, err := s.audit.Append(ctx, tx, audit.Entry{
			EntityType: "service_entry", EntityID: strconv.FormatInt(entryID, 10), Actor: actor.EmployeeID,
			Action: "create", After: after, At: now,
		}); err != nil {
			return err
		}

		entry = ServiceEntry{ID: entryID, Name: in.Name, Active: true, CreatedAt: now, CreatedBy: actor.EmployeeID}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

// UpdateInput is the payload for UpdateEntry. Unset (nil) pointer fields
// carry over unchanged from the current latest version; EffectiveFrom is
// always required (it's what makes this a new, dated version).
type UpdateInput struct {
	Name           *string
	StandardPrice  *string
	CommissionRule *string
	Active         *bool
	EffectiveFrom  time.Time
}

// UpdateEntry creates a new version (current max version + 1) for an
// existing entry. The prior version row is left completely intact --
// versions are never updated in place (house convention #3).
func (s *Store) UpdateEntry(ctx context.Context, conn *sql.DB, actor authz.Identity, entryID int64, in UpdateInput) (*ServiceVersion, error) {
	if err := s.requireSalesWrite(actor); err != nil {
		return nil, err
	}
	if in.EffectiveFrom.IsZero() {
		return nil, validationErr()
	}
	if in.StandardPrice != nil && !decimalPattern.MatchString(*in.StandardPrice) {
		return nil, validationErr()
	}
	if in.CommissionRule != nil && !json.Valid([]byte(*in.CommissionRule)) {
		return nil, validationErr()
	}
	if in.Name != nil && *in.Name == "" {
		return nil, validationErr()
	}

	var newVersion ServiceVersion
	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		// Lock the entry row so concurrent updates serialize on the version
		// number allocation below.
		var exists int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM service_entries WHERE id = ? FOR UPDATE`, entryID).Scan(&exists); err != nil {
			if err == sql.ErrNoRows {
				return ErrNotFound
			}
			return err
		}

		latest, err := latestVersion(ctx, tx, entryID)
		if err != nil {
			return err
		}

		now := time.Now().UTC()
		newVersion = ServiceVersion{
			EntryID:        entryID,
			Version:        latest.Version + 1,
			Name:           latest.Name,
			StandardPrice:  latest.StandardPrice,
			CommissionRule: latest.CommissionRule,
			Active:         latest.Active,
			EffectiveFrom:  in.EffectiveFrom,
			CreatedAt:      now,
			CreatedBy:      actor.EmployeeID,
		}
		if in.Name != nil {
			newVersion.Name = *in.Name
		}
		if in.StandardPrice != nil {
			newVersion.StandardPrice = *in.StandardPrice
		}
		if in.CommissionRule != nil {
			newVersion.CommissionRule = *in.CommissionRule
		}
		if in.Active != nil {
			newVersion.Active = *in.Active
		}

		if err := insertVersion(ctx, tx, &newVersion); err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx,
			`UPDATE service_entries SET name = ?, active = ? WHERE id = ?`,
			newVersion.Name, newVersion.Active, entryID,
		); err != nil {
			return err
		}

		before, _ := json.Marshal(latest)
		after, _ := json.Marshal(newVersion)
		_, err = s.audit.Append(ctx, tx, audit.Entry{
			EntityType: "service_entry", EntityID: strconv.FormatInt(entryID, 10), Actor: actor.EmployeeID,
			Action: "update", Before: before, After: after, At: now,
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return &newVersion, nil
}

// DeactivateEntry is a convenience wrapper over UpdateEntry that flips
// Active to false as a new version, leaving name/price/commission carried
// over from the latest version unchanged.
func (s *Store) DeactivateEntry(ctx context.Context, conn *sql.DB, actor authz.Identity, entryID int64, effectiveFrom time.Time) (*ServiceVersion, error) {
	inactive := false
	return s.UpdateEntry(ctx, conn, actor, entryID, UpdateInput{Active: &inactive, EffectiveFrom: effectiveFrom})
}

// GetEntry reads the current header row. Reads are open to any
// authenticated internal role (Phase 0 §10 -- ownership restricts writes,
// not reads); an unmapped/unauthenticated Identity is denied with the same
// typed authz denial the write path returns (errors.Is(err, authz.ErrDenied)).
func GetEntry(ctx context.Context, q db.Queryer, actor authz.Identity, entryID int64) (*ServiceEntry, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	var e ServiceEntry
	var active bool
	err := q.QueryRowContext(ctx,
		`SELECT id, name, active, created_at, created_by FROM service_entries WHERE id = ?`, entryID,
	).Scan(&e.ID, &e.Name, &active, &e.CreatedAt, &e.CreatedBy)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	e.Active = active
	return &e, nil
}

// ListEntries reads every current header row, any authenticated internal
// role. An unmapped/unauthenticated Identity is denied with the same typed
// authz denial the write path returns (errors.Is(err, authz.ErrDenied)).
func ListEntries(ctx context.Context, q db.Queryer, actor authz.Identity) ([]ServiceEntry, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	rows, err := q.QueryContext(ctx, `SELECT id, name, active, created_at, created_by FROM service_entries ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ServiceEntry
	for rows.Next() {
		var e ServiceEntry
		if err := rows.Scan(&e.ID, &e.Name, &e.Active, &e.CreatedAt, &e.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func insertVersion(ctx context.Context, tx *sql.Tx, v *ServiceVersion) error {
	res, err := tx.ExecContext(ctx,
		`INSERT INTO service_entry_versions
			(entry_id, version, name, standard_price, commission_rule, active, effective_from, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		v.EntryID, v.Version, v.Name, v.StandardPrice, v.CommissionRule, v.Active, v.EffectiveFrom, v.CreatedAt, v.CreatedBy,
	)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	v.ID = id
	return nil
}

func latestVersion(ctx context.Context, q db.Queryer, entryID int64) (*ServiceVersion, error) {
	var v ServiceVersion
	err := q.QueryRowContext(ctx,
		`SELECT id, entry_id, version, name, standard_price, commission_rule, active, effective_from, created_at, created_by
		 FROM service_entry_versions WHERE entry_id = ? ORDER BY version DESC LIMIT 1`,
		entryID,
	).Scan(&v.ID, &v.EntryID, &v.Version, &v.Name, &v.StandardPrice, &v.CommissionRule, &v.Active, &v.EffectiveFrom, &v.CreatedAt, &v.CreatedBy)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}
