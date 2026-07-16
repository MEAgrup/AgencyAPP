// read.go — Module 1 read layer (Sales Workspace v1). Pure read-only projections
// of the leads / prospect_attempts registry for the GET endpoints; NO mutation,
// NO status write, NO audit row (reads never audit — consistent with the other
// GET endpoints).
//
// Visibility follows PERMISSIONS.md (Global + M0/M1). The `stale` signal
// (M1-OA-7, >24h in [Pool]) is DERIVED — never stored — from the audit_log
// transition row into [Pool] (fallback: leads.created_at when the lead was born
// in the Pool), honouring house rules §3/§4. active_owners LEFT JOINs employees
// and filters via IsTerminalAttempt (consistent with O19 / MatchByPhone).
package module1_leads

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// MarketingDivision owns imported (attribution) leads. Marketing keeps read-only
// visibility over the pool + all views (M1-OA-5).
const MarketingDivision = "Marketing"

// Lead list views (query param `view`).
const (
	ViewPool = "pool"
	ViewMine = "mine"
	ViewAll  = "all"
)

// ErrLeadForbidden denies a lead read the actor is not entitled to. The message
// reuses the existing read-access BI string (admin handlers, Sprint 0) — the
// transition-denial constant would read wrongly on a GET. httpapi.writeDomainErr
// maps this error to 403 verbatim; no new BI string is invented.
var ErrLeadForbidden = errors.New("[anda tidak memiliki akses ke data ini]")

// LeadView is the API projection of a lead row (list + detail share it).
type LeadView struct {
	ID               string
	LeadName         string
	PhoneNumber      string
	Source           string
	RecordStatus     string
	OriginDivision   string
	ManualReviewFlag bool
	Stale            bool
	ActiveOwners     []AttemptOwner
	WinningAttemptID *string
	CreatedAt        time.Time
}

// LeadAttemptView is one prospect attempt shown under a lead detail.
type LeadAttemptView struct {
	ID              string
	OwnerEmployeeID string
	OwnerName       string
	Status          string
	CreatedAt       time.Time
	IsWinner        bool
}

// canSeeLeads reports whether the actor has any lead-read scope at all. Leads are
// a Sales domain; Marketing keeps read-only attribution access; OD/Director read
// everywhere.
func canSeeLeads(actor permission.Actor) bool {
	return actor.Role.Director || actor.Role.OD ||
		actor.Role.Division == SalesDivision || actor.Role.Division == MarketingDivision
}

// canSeeAllLeads reports whether the actor may use the division-wide `all` view.
// Sales staff are own-data only (denied); Sales Lead/SPV, Marketing (staff+lead),
// OD and Director may see all.
func canSeeAllLeads(actor permission.Actor) bool {
	if actor.Role.Director || actor.Role.OD {
		return true
	}
	if actor.Role.Division == MarketingDivision {
		return true
	}
	return actor.Role.Division == SalesDivision && actor.Role.Level == permission.LevelLead
}

// ListLeads returns leads for the requested view, ordered created_at DESC, with
// the derived stale flag and active_owners resolved. q matches lead_name OR the
// normalized phone.
func (s *Service) ListLeads(ctx context.Context, actor permission.Actor, view, q string) ([]LeadView, error) {
	if !canSeeLeads(actor) {
		return nil, ErrLeadForbidden
	}
	switch view {
	case ViewPool, ViewMine:
	case ViewAll:
		if !canSeeAllLeads(actor) {
			return nil, ErrLeadForbidden
		}
	default:
		view = ViewPool
	}

	query := `SELECT l.id, l.lead_name, l.phone_number, l.source, l.record_status,
	                 l.origin_division, l.manual_review_flag, l.winning_attempt_id, l.created_at, ` +
		staleFlagExpr + ` AS stale_flag
	          FROM leads l WHERE 1=1`
	var args []any

	switch view {
	case ViewPool:
		query += " AND l.record_status = ?"
		args = append(args, RecordPool)
	case ViewMine:
		query += " AND EXISTS (SELECT 1 FROM prospect_attempts pa WHERE pa.lead_id = l.id AND pa.owner_employee_id = ?)"
		args = append(args, actor.EmployeeID)
	}

	if q = strings.TrimSpace(q); q != "" {
		query += " AND (l.lead_name LIKE ? OR l.phone_norm = ?)"
		args = append(args, "%"+q+"%", NormalizePhone(q))
	}
	query += " ORDER BY l.created_at DESC, l.id DESC"

	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var views []LeadView
	var ids []string
	for rows.Next() {
		v, err := scanLeadView(rows)
		if err != nil {
			return nil, err
		}
		views = append(views, v)
		ids = append(ids, v.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	owners, err := loadActiveOwners(ctx, s.DB, ids)
	if err != nil {
		return nil, err
	}
	for i := range views {
		views[i].ActiveOwners = owners[views[i].ID]
	}
	return views, nil
}

// GetLead returns one lead (same projection as the list) plus its attempts. A
// missing lead is ErrLeadNotFound; a lead the actor may not see is
// ErrLeadForbidden.
func (s *Service) GetLead(ctx context.Context, actor permission.Actor, id string) (LeadView, []LeadAttemptView, error) {
	if !canSeeLeads(actor) {
		return LeadView{}, nil, ErrLeadForbidden
	}
	query := `SELECT l.id, l.lead_name, l.phone_number, l.source, l.record_status,
	                 l.origin_division, l.manual_review_flag, l.winning_attempt_id, l.created_at, ` +
		staleFlagExpr + ` AS stale_flag
	          FROM leads l WHERE l.id = ?`
	row := s.DB.QueryRowContext(ctx, query, id)
	v, err := scanLeadView(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return LeadView{}, nil, ErrLeadNotFound
		}
		return LeadView{}, nil, err
	}

	entitled, err := s.canSeeLead(ctx, actor, v)
	if err != nil {
		return LeadView{}, nil, err
	}
	if !entitled {
		return LeadView{}, nil, ErrLeadForbidden
	}

	owners, err := loadActiveOwners(ctx, s.DB, []string{v.ID})
	if err != nil {
		return LeadView{}, nil, err
	}
	v.ActiveOwners = owners[v.ID]

	attempts, err := s.loadLeadAttempts(ctx, v.ID, v.WinningAttemptID)
	if err != nil {
		return LeadView{}, nil, err
	}
	return v, attempts, nil
}

// canSeeLead applies the detail-visibility rule: Sales staff may see a lead only
// when it is in [Pool] or they hold an attempt on it; Sales Lead/SPV, Marketing,
// OD and Director may see any lead.
func (s *Service) canSeeLead(ctx context.Context, actor permission.Actor, v LeadView) (bool, error) {
	if actor.Role.Director || actor.Role.OD || actor.Role.Division == MarketingDivision {
		return true, nil
	}
	if actor.Role.Division == SalesDivision && actor.Role.Level == permission.LevelLead {
		return true, nil
	}
	if actor.Role.Division == SalesDivision && actor.Role.Level == permission.LevelStaff {
		if v.RecordStatus == RecordPool {
			return true, nil
		}
		return s.actorHasAnyAttempt(ctx, v.ID, actor.EmployeeID)
	}
	return false, nil
}

// actorHasAnyAttempt reports whether the actor owns any attempt (terminal or not)
// on the lead — the "punya attempt" leg of the Sales-staff detail rule.
func (s *Service) actorHasAnyAttempt(ctx context.Context, leadID, employeeID string) (bool, error) {
	var one int
	err := s.DB.QueryRowContext(ctx,
		`SELECT 1 FROM prospect_attempts WHERE lead_id = ? AND owner_employee_id = ? LIMIT 1`,
		leadID, employeeID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) loadLeadAttempts(ctx context.Context, leadID string, winner *string) ([]LeadAttemptView, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT pa.id, pa.owner_employee_id, COALESCE(e.nama, ''), pa.status, pa.created_at
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id = ?
		  ORDER BY pa.created_at ASC, pa.id ASC`, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LeadAttemptView
	for rows.Next() {
		var a LeadAttemptView
		if err := rows.Scan(&a.ID, &a.OwnerEmployeeID, &a.OwnerName, &a.Status, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.IsWinner = winner != nil && *winner == a.ID
		out = append(out, a)
	}
	return out, rows.Err()
}

// staleFlagExpr is the DERIVED >24h-in-[Pool] predicate. The whole comparison is
// evaluated in the DB clock (NOW()) against the last audit transition INTO [Pool]
// (or the lead's created_at when it was born in the Pool with no transition row),
// so no stored/computed column is introduced and no timezone drift can occur.
const staleFlagExpr = `(COALESCE(
	(SELECT MAX(a.created_at) FROM audit_log a
	   WHERE a.entity_type = 'lead' AND a.entity_id = l.id
	     AND a.action LIKE 'transition:%->[Pool]'),
	l.created_at) < (NOW() - INTERVAL 24 HOUR))`

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanLeadView(sc rowScanner) (LeadView, error) {
	var v LeadView
	var winning sql.NullString
	var manualFlag, staleFlag int64
	if err := sc.Scan(&v.ID, &v.LeadName, &v.PhoneNumber, &v.Source, &v.RecordStatus,
		&v.OriginDivision, &manualFlag, &winning, &v.CreatedAt, &staleFlag); err != nil {
		return LeadView{}, err
	}
	v.ManualReviewFlag = manualFlag != 0
	if winning.Valid && winning.String != "" {
		w := winning.String
		v.WinningAttemptID = &w
	}
	// stale only meaningful for a lead sitting in [Pool] (M1-OA-7).
	v.Stale = v.RecordStatus == RecordPool && staleFlag != 0
	return v, nil
}

// loadActiveOwners resolves the non-terminal attempt owners for a set of leads in
// one query (LEFT JOIN employees; name may be "" for an unsynced owner — O19).
func loadActiveOwners(ctx context.Context, db *sql.DB, leadIDs []string) (map[string][]AttemptOwner, error) {
	res := map[string][]AttemptOwner{}
	if len(leadIDs) == 0 {
		return res, nil
	}
	args := make([]any, len(leadIDs))
	for i, id := range leadIDs {
		args[i] = id
	}
	rows, err := db.QueryContext(ctx,
		`SELECT pa.lead_id, pa.owner_employee_id, COALESCE(e.nama, ''), pa.status
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id IN (`+placeholders(len(leadIDs))+`)
		  ORDER BY pa.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var leadID, ownerID, name, status string
		if err := rows.Scan(&leadID, &ownerID, &name, &status); err != nil {
			return nil, err
		}
		if IsTerminalAttempt(status) {
			continue
		}
		res[leadID] = append(res[leadID], AttemptOwner{EmployeeID: ownerID, Name: name})
	}
	return res, rows.Err()
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}
