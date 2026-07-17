package module4_client

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// MsgFieldLocked is the verbatim rejection for any edit blocked by the lock
// matrix — a never-editable field, or a field the actor's role may not correct
// (DECISIONS O10/O17).
const MsgFieldLocked = "[field ini terkunci, tidak bisa diubah]"

// MsgIncomplete is the default mandatory-field / invalid-request message.
const MsgIncomplete = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"

var (
	// ErrFieldLocked: the edit is denied by the lock matrix (M4 §4).
	ErrFieldLocked = errors.New(MsgFieldLocked)
	// ErrInvalidField: an unknown field, or no editable field supplied.
	ErrInvalidField = errors.New(MsgIncomplete)
)

// Client Record field names — the identifiers used by the lock matrix and the
// PATCH request. These mirror docs/prd M4 §4 row-for-row.
const (
	FieldClientID        = "client_id"
	FieldNamaPIC         = "nama_pic"
	FieldToko            = "toko"
	FieldKota            = "kota"
	FieldLinkToko        = "link_toko"
	FieldKategori        = "kategori"
	FieldPlatformList    = "platform_list"
	FieldServiceSet      = "service_set"
	FieldGMVBaseline     = "gmv_baseline"
	FieldTargetGMV       = "target_gmv"
	FieldMarketingBudget = "marketing_budget"
	FieldTotalSales      = "total_sales"
	FieldOriginCampaign  = "origin_campaign_id"
	FieldSalesPIC        = "sales_pic_id"
	FieldCommissionPIC   = "commission_payment_pic_id"
	FieldSalesAllocation = "sales_allocation"
	FieldTransactionID   = "transaction_id"
)

// editPolicy names WHO may correct a field. Keeping the authorisation as a small
// enum (with allows() below) makes the lock matrix a flat data table rather than
// if/else scattered across handlers.
type editPolicy int

const (
	// policyNever: immutable — no role may edit. Auto-computed fields (Total
	// Sales, house convention §2.6) and system-stamped identity/links.
	policyNever editPolicy = iota
	// policyProfileCorrection: locked profile fields — Account Lead OR OD OR
	// Director (M4-OA-4; OD is the explicit PRD exception to OD-read-only).
	policyProfileCorrection
	// policyBaselineCorrection: GMV baseline — OD (exceptional) OR Director.
	policyBaselineCorrection
	// policyAccountRevisable: Target GMV / Marketing Budget — any Account
	// (staff or lead) OR Director (M4-OA-6).
	policyAccountRevisable
	// policySalesReassign: Sales PIC / Commission & Payment PIC — Sales Lead OR
	// Director.
	policySalesReassign
)

func (p editPolicy) allows(a permission.Actor) bool {
	if p == policyNever {
		// Immutable / auto-computed: no role, not even Director, may write.
		return false
	}
	if a.Role.Director {
		return true
	}
	switch p {
	case policyProfileCorrection:
		// M4-OA-4: Account Lead OR OD. (OD write here is an explicit PRD
		// exception to the OD-read-only convention.)
		return a.Role.OD || (a.Role.Division == AccountDivision && a.Role.Level == permission.LevelLead)
	case policyBaselineCorrection:
		return a.Role.OD
	case policyAccountRevisable:
		return a.Role.Division == AccountDivision
	case policySalesReassign:
		return a.Role.Division == SalesDivision && a.Role.Level == permission.LevelLead
	default: // policyNever
		return false
	}
}

// lockField is one row of the lock matrix.
type lockField struct {
	policy editPolicy
	column string // clients-table column; "" = not a scalar column on this endpoint
	money  bool   // value is an IDR amount (parse+store as DECIMAL)
}

// lockMatrix is the explicit M4 §4 contract as data. Every field the record
// exposes appears exactly once. Fields with column "" are either never editable
// or edited through a dedicated multi-row flow (platform list — deferred to M6,
// see docs/DECISIONS.md); this endpoint writes only scalar clients columns.
var lockMatrix = map[string]lockField{
	FieldClientID:        {policy: policyNever},
	FieldOriginCampaign:  {policy: policyNever},
	FieldTransactionID:   {policy: policyNever},
	FieldSalesAllocation: {policy: policyNever},
	FieldServiceSet:      {policy: policyNever},
	FieldTotalSales:      {policy: policyNever, column: "total_sales"}, // auto-computed; nobody writes
	FieldNamaPIC:         {policy: policyProfileCorrection, column: "nama_pic"},
	FieldToko:            {policy: policyProfileCorrection, column: "toko"},
	FieldKota:            {policy: policyProfileCorrection, column: "kota"},
	FieldLinkToko:        {policy: policyProfileCorrection, column: "link_toko"},
	FieldKategori:        {policy: policyProfileCorrection, column: "kategori"},
	FieldPlatformList:    {policy: policyProfileCorrection}, // multi-row; correction flow deferred to M6
	FieldGMVBaseline:     {policy: policyBaselineCorrection, column: "gmv_baseline", money: true},
	FieldTargetGMV:       {policy: policyAccountRevisable, column: "target_gmv", money: true},
	FieldMarketingBudget: {policy: policyAccountRevisable, column: "marketing_budget", money: true},
	FieldSalesPIC:        {policy: policySalesReassign, column: "sales_pic_id"},
	FieldCommissionPIC:   {policy: policySalesReassign, column: "commission_payment_pic_id"},
}

// CanEdit reports whether actor may correct field per the lock matrix. Unknown
// fields return false. This is the pure predicate behind the M4 §4 contract.
func CanEdit(actor permission.Actor, field string) bool {
	f, ok := lockMatrix[field]
	if !ok {
		return false
	}
	return f.policy.allows(actor)
}

// FieldChange records one applied correction for the response/audit.
type FieldChange struct {
	Field  string `json:"field"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// Edit applies role-authorised corrections to a client's scalar fields (M4 §4).
// It validates EVERY requested field against the lock matrix first; if any is
// denied, nothing is written and ErrFieldLocked is returned. Each permitted
// change writes the new value plus an immutable before→after audit row, all in
// one transaction. History is never deleted.
func (s *Service) Edit(ctx context.Context, actor permission.Actor, clientID string, changes map[string]string) ([]FieldChange, error) {
	if len(changes) == 0 {
		return nil, ErrInvalidField
	}
	// Phase 1: validate the whole batch before touching the row.
	for field := range changes {
		f, ok := lockMatrix[field]
		if !ok {
			return nil, ErrInvalidField
		}
		if !f.policy.allows(actor) {
			return nil, ErrFieldLocked
		}
		if f.column == "" {
			// Allowed by policy but not a scalar column on this endpoint
			// (platform list). Not supported here.
			return nil, ErrInvalidField
		}
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Lock the client row, subject to the SAME visibility(actor) predicate as
	// Get/List (M4 §6); also proves existence. A client invisible to the actor
	// (e.g. an unreleased client, to Account) is indistinguishable from one that
	// does not exist — same rule as Get, closing the gap the row-lock probe used
	// to leave open.
	clause, visArgs, ok := visibility(actor)
	if !ok {
		return nil, ErrNotFound
	}
	var exists string
	lockQ := `SELECT id FROM clients c WHERE c.id = ? AND (` + clause + `) FOR UPDATE`
	if err := tx.QueryRowContext(ctx, lockQ, append([]any{clientID}, visArgs...)...).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	applied := make([]FieldChange, 0, len(changes))
	for field, raw := range changes {
		f := lockMatrix[field]

		newVal := raw
		var newMoney money.Money
		if f.money {
			m, perr := money.Parse(raw)
			if perr != nil {
				return nil, ErrInvalidField
			}
			newMoney = m
			newVal = m.Decimal()
		}

		var before string
		if err := tx.QueryRowContext(ctx,
			"SELECT COALESCE(CAST("+f.column+" AS CHAR), '') FROM clients WHERE id = ?", clientID).Scan(&before); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE clients SET "+f.column+" = ? WHERE id = ?", newVal, clientID); err != nil {
			return nil, err
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID,
			Action: "edit:" + field,
			Before: map[string]string{field: before},
			After:  map[string]string{field: newVal},
		}); err != nil {
			return nil, err
		}

		// The audit row above keeps the canonical decimal (recomputability,
		// CLAUDE.md #4); the RETURNED change renders money in the house IDR
		// convention (CLAUDE.md #7). Non-money fields, and an empty ("") before
		// on a field that was previously unset, are returned unchanged.
		respBefore, respAfter := before, newVal
		if f.money {
			respAfter = newMoney.Format()
			if before != "" {
				beforeMoney, perr := money.Parse(before)
				if perr != nil {
					return nil, perr
				}
				respBefore = beforeMoney.Format()
			}
		}
		applied = append(applied, FieldChange{Field: field, Before: respBefore, After: respAfter})
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return applied, nil
}
