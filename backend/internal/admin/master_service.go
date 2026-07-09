// Package admin implements Master Service List administration (S0-09) and
// role-mapping / layered-role management (S0-08).
package admin

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// MasterServiceDeniedMessage is the exact BI message for unauthorized edits.
const MasterServiceDeniedMessage = "[anda tidak memiliki akses untuk mengubah master service list]"

// SalesDivision is the CDPS division that owns the Master Service List.
const SalesDivision = "Sales"

// ErrMasterServiceDenied is returned when the actor may not edit the list.
var ErrMasterServiceDenied = errors.New(MasterServiceDeniedMessage)

// CanEditMasterServices reports whether the actor may add/edit master services.
// Restricted to Sales division level=lead (Sales Head/SPV); Director is full.
// A plain salesperson (Sales staff) is denied.
func CanEditMasterServices(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == SalesDivision && a.Role.Level == permission.LevelLead
}

// ServiceVersion is one immutable master-service version.
type ServiceVersion struct {
	ID             int64     `json:"id"`
	ServiceID      string    `json:"service_id"`
	VersionNo      int       `json:"version_no"`
	Name           string    `json:"name"`
	StandardPrice  string    `json:"standard_price"`
	CommissionRule string    `json:"commission_rule"`
	Active         bool      `json:"active"`
	EffectiveFrom  string    `json:"effective_from"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
}

// ServiceView is the effective view of a service at a date (id = service id).
type ServiceView struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	StandardPrice  string `json:"standard_price"`
	CommissionRule string `json:"commission_rule"`
	Active         bool   `json:"active"`
	VersionNo      int    `json:"version_no"`
	EffectiveFrom  string `json:"effective_from"`
}

// ServiceInput carries create/update fields.
type ServiceInput struct {
	Name           string
	StandardPrice  string
	CommissionRule string
	Active         bool
	EffectiveFrom  string // YYYY-MM-DD
}

func (in ServiceInput) valid() bool {
	return in.Name != "" && in.StandardPrice != "" && in.CommissionRule != "" && in.EffectiveFrom != ""
}

// CreateService creates a new master service with version 1 (+ audit).
func CreateService(ctx context.Context, d *sql.DB, actor permission.Actor, in ServiceInput) (string, error) {
	if !CanEditMasterServices(actor) {
		return "", ErrMasterServiceDenied
	}
	if !in.valid() {
		return "", ErrIncomplete
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// ID only after validation passes.
	id, err := ident.Next(ctx, tx, "MSV", time.Now())
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO master_services (id, created_by) VALUES (?, ?)`, id, actor.EmployeeID); err != nil {
		return "", err
	}
	if err := insertVersion(ctx, tx, id, 1, in, actor.EmployeeID); err != nil {
		return "", err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "master_service", EntityID: id, Actor: actor.EmployeeID,
		Action: "create", After: map[string]any{"version_no": 1, "name": in.Name, "standard_price": in.StandardPrice},
	}); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

// UpdateService appends a new version to an existing service (+ audit). Every
// change is a new version; nothing is mutated in place.
func UpdateService(ctx context.Context, d *sql.DB, actor permission.Actor, serviceID string, in ServiceInput) (int, error) {
	if !CanEditMasterServices(actor) {
		return 0, ErrMasterServiceDenied
	}
	if !in.valid() {
		return 0, ErrIncomplete
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var maxVer sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(version_no) FROM master_service_versions WHERE service_id = ?`, serviceID).Scan(&maxVer); err != nil {
		return 0, err
	}
	if !maxVer.Valid {
		return 0, ErrServiceNotFound
	}
	next := int(maxVer.Int64) + 1
	if err := insertVersion(ctx, tx, serviceID, next, in, actor.EmployeeID); err != nil {
		return 0, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "master_service", EntityID: serviceID, Actor: actor.EmployeeID,
		Action: "new_version", After: map[string]any{"version_no": next, "name": in.Name, "standard_price": in.StandardPrice},
	}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return next, nil
}

func insertVersion(ctx context.Context, tx *sql.Tx, serviceID string, versionNo int, in ServiceInput, actor string) error {
	active := 0
	if in.Active {
		active = 1
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO master_service_versions
		   (service_id, version_no, name, standard_price, commission_rule, active, effective_from, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		serviceID, versionNo, in.Name, in.StandardPrice, in.CommissionRule, active, in.EffectiveFrom, actor)
	return err
}

// Sentinel errors.
var (
	ErrIncomplete      = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	ErrServiceNotFound = errors.New("master service not found")
)

// EffectiveAt returns the version of one service effective at date (YYYY-MM-DD).
func EffectiveAt(ctx context.Context, d *sql.DB, serviceID, date string) (ServiceView, error) {
	var v ServiceView
	v.ID = serviceID
	var eff time.Time
	err := d.QueryRowContext(ctx,
		`SELECT name, standard_price, commission_rule, active, version_no, effective_from
		   FROM master_service_versions
		  WHERE service_id = ? AND effective_from <= ?
		  ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
		serviceID, date).Scan(&v.Name, &v.StandardPrice, &v.CommissionRule, &v.Active, &v.VersionNo, &eff)
	if err == sql.ErrNoRows {
		return v, ErrServiceNotFound
	}
	if err != nil {
		return v, err
	}
	v.EffectiveFrom = eff.Format("2006-01-02")
	return v, nil
}

// ListEffectiveAt returns every service's version effective at date.
func ListEffectiveAt(ctx context.Context, d *sql.DB, date string) ([]ServiceView, error) {
	rows, err := d.QueryContext(ctx, `SELECT id FROM master_services ORDER BY id`)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := []ServiceView{}
	for _, id := range ids {
		v, err := EffectiveAt(ctx, d, id, date)
		if err == ErrServiceNotFound {
			continue // no version effective yet at that date
		}
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// ListVersions returns all versions for a service, newest first.
func ListVersions(ctx context.Context, d *sql.DB, serviceID string) ([]ServiceVersion, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT id, service_id, version_no, name, standard_price, commission_rule, active, effective_from, created_by, created_at
		   FROM master_service_versions WHERE service_id = ? ORDER BY version_no DESC`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ServiceVersion{}
	for rows.Next() {
		var v ServiceVersion
		var eff time.Time
		if err := rows.Scan(&v.ID, &v.ServiceID, &v.VersionNo, &v.Name, &v.StandardPrice, &v.CommissionRule, &v.Active, &eff, &v.CreatedBy, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.EffectiveFrom = eff.Format("2006-01-02")
		out = append(out, v)
	}
	return out, rows.Err()
}
