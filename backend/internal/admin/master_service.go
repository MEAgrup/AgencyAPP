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
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// Pricing modes for the MSL v2 calculator (mirror module0_sales; kept as local
// literals so admin never imports module0_sales — that would form a cycle).
const (
	pricingFlat         = "flat"
	pricingMinFloor     = "min_floor"
	pricingBatchCeiling = "batch_ceiling"
	pricingPassthrough  = "passthrough"
)

var pricingModes = map[string]bool{
	pricingFlat: true, pricingMinFloor: true, pricingBatchCeiling: true, pricingPassthrough: true,
}

var frequencies = map[string]bool{"Monthly": true, "One-time": true, "Campaign": true}

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
	ID                   int64     `json:"id"`
	ServiceID            string    `json:"service_id"`
	VersionNo            int       `json:"version_no"`
	Name                 string    `json:"name"`
	StandardPrice        string    `json:"standard_price"`
	CommissionRule       string    `json:"commission_rule"`
	Category             string    `json:"category"`
	Unit                 string    `json:"unit"`
	MinQty               string    `json:"min_qty"`
	PricingMode          string    `json:"pricing_mode"`
	ApplyPPN             bool      `json:"apply_ppn"`
	Frequency            string    `json:"frequency"`
	PriceNote            string    `json:"price_note"`
	Description          string    `json:"description"`
	Active               bool      `json:"active"`
	RequiresStrategyPlan bool      `json:"requires_strategy_plan"`
	EffectiveFrom        string    `json:"effective_from"`
	CreatedBy            string    `json:"created_by"`
	CreatedAt            time.Time `json:"created_at"`
}

// ServiceView is the effective view of a service at a date (id = service id).
type ServiceView struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	StandardPrice        string `json:"standard_price"`
	CommissionRule       string `json:"commission_rule"`
	Category             string `json:"category"`
	Unit                 string `json:"unit"`
	MinQty               string `json:"min_qty"`
	PricingMode          string `json:"pricing_mode"`
	ApplyPPN             bool   `json:"apply_ppn"`
	Frequency            string `json:"frequency"`
	PriceNote            string `json:"price_note"`
	Description          string `json:"description"`
	Active               bool   `json:"active"`
	RequiresStrategyPlan bool   `json:"requires_strategy_plan"`
	VersionNo            int    `json:"version_no"`
	EffectiveFrom        string `json:"effective_from"`
}

// ServiceInput carries create/update fields. RequiresStrategyPlan is the M6 §2
// "Requires Strategy Plan" catalog flag (Yes ⇒ Plan-gated, No ⇒ Direct);
// optional and default false so an unspecified catalog entry stays Direct.
type ServiceInput struct {
	Name                 string
	StandardPrice        string
	CommissionRule       string
	Category             string
	Unit                 string
	MinQty               string
	PricingMode          string
	ApplyPPN             bool
	Frequency            string
	PriceNote            string
	Description          string
	Active               bool
	RequiresStrategyPlan bool
	EffectiveFrom        string // YYYY-MM-DD
}

// normalize validates the MSL v2 calculator fields, applying the flat default
// and normalizing passthrough's unit price to "0". Invalid input returns
// ErrIncomplete (the house default BI string — no new strings invented).
func (in *ServiceInput) normalize() error {
	if in.Name == "" || in.CommissionRule == "" || in.EffectiveFrom == "" {
		return ErrIncomplete
	}
	if in.PricingMode == "" {
		in.PricingMode = pricingFlat
	}
	if !pricingModes[in.PricingMode] {
		return ErrIncomplete
	}
	if in.Frequency != "" && !frequencies[in.Frequency] {
		return ErrIncomplete
	}

	if in.PricingMode == pricingPassthrough {
		// Unit price is ignored for passthrough; normalize "" / "0" to "0".
		if in.StandardPrice == "" {
			in.StandardPrice = "0"
		}
		if p, err := money.Parse(in.StandardPrice); err != nil || p < 0 {
			return ErrIncomplete
		}
	} else {
		p, err := money.Parse(in.StandardPrice)
		if err != nil || p <= 0 {
			return ErrIncomplete
		}
	}

	if in.PricingMode == pricingMinFloor || in.PricingMode == pricingBatchCeiling {
		norm, ok := wholePositive(in.MinQty)
		if !ok {
			return ErrIncomplete
		}
		in.MinQty = norm
	}
	return nil
}

// wholePositive validates that s is a whole positive integer (DECIMAL string),
// returning it normalized to a DECIMAL(15,2) representation.
func wholePositive(s string) (string, bool) {
	m, err := money.Parse(s)
	if err != nil || m <= 0 || int64(m)%100 != 0 {
		return "", false
	}
	return m.Decimal(), true
}

// CreateService creates a new master service with version 1 (+ audit).
func CreateService(ctx context.Context, d *sql.DB, actor permission.Actor, in ServiceInput) (string, error) {
	if !CanEditMasterServices(actor) {
		return "", ErrMasterServiceDenied
	}
	if err := in.normalize(); err != nil {
		return "", err
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
		Action: "create", After: map[string]any{"version_no": 1, "name": in.Name, "standard_price": in.StandardPrice, "pricing_mode": in.PricingMode},
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
	if err := in.normalize(); err != nil {
		return 0, err
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
		Action: "new_version", After: map[string]any{"version_no": next, "name": in.Name, "standard_price": in.StandardPrice, "pricing_mode": in.PricingMode},
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
	ppn := 0
	if in.ApplyPPN {
		ppn = 1
	}
	rsp := 0
	if in.RequiresStrategyPlan {
		rsp = 1
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO master_service_versions
		   (service_id, version_no, name, standard_price, commission_rule, category, unit,
		    min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
		    active, requires_strategy_plan, effective_from, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		serviceID, versionNo, in.Name, in.StandardPrice, in.CommissionRule,
		nullText(in.Category), nullText(in.Unit), nullText(in.MinQty), in.PricingMode, ppn,
		nullText(in.Frequency), nullText(in.PriceNote), nullText(in.Description),
		active, rsp, in.EffectiveFrom, actor)
	return err
}

// nullText stores empty optional strings as SQL NULL.
func nullText(s string) any {
	if s == "" {
		return nil
	}
	return s
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
	var category, unit, minQty, frequency, priceNote, description sql.NullString
	err := d.QueryRowContext(ctx,
		`SELECT name, standard_price, commission_rule, category, unit, min_qty,
		        pricing_mode, apply_ppn, frequency, price_note, description,
		        active, requires_strategy_plan, version_no, effective_from
		   FROM master_service_versions
		  WHERE service_id = ? AND effective_from <= ?
		  ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
		serviceID, date).Scan(&v.Name, &v.StandardPrice, &v.CommissionRule, &category, &unit, &minQty,
		&v.PricingMode, &v.ApplyPPN, &frequency, &priceNote, &description, &v.Active, &v.RequiresStrategyPlan, &v.VersionNo, &eff)
	if err == sql.ErrNoRows {
		return v, ErrServiceNotFound
	}
	if err != nil {
		return v, err
	}
	v.Category, v.Unit, v.MinQty = category.String, unit.String, minQty.String
	v.Frequency, v.PriceNote, v.Description = frequency.String, priceNote.String, description.String
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
		`SELECT id, service_id, version_no, name, standard_price, commission_rule,
		        category, unit, min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
		        active, requires_strategy_plan, effective_from, created_by, created_at
		   FROM master_service_versions WHERE service_id = ? ORDER BY version_no DESC`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ServiceVersion{}
	for rows.Next() {
		var v ServiceVersion
		var eff time.Time
		var category, unit, minQty, frequency, priceNote, description sql.NullString
		if err := rows.Scan(&v.ID, &v.ServiceID, &v.VersionNo, &v.Name, &v.StandardPrice, &v.CommissionRule,
			&category, &unit, &minQty, &v.PricingMode, &v.ApplyPPN, &frequency, &priceNote, &description,
			&v.Active, &v.RequiresStrategyPlan, &eff, &v.CreatedBy, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Category, v.Unit, v.MinQty = category.String, unit.String, minQty.String
		v.Frequency, v.PriceNote, v.Description = frequency.String, priceNote.String, description.String
		v.EffectiveFrom = eff.Format("2006-01-02")
		out = append(out, v)
	}
	return out, rows.Err()
}
