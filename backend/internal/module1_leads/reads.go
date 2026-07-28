// reads.go — M1 Leads read model: the Sales Pool board (M1-OA-7 stale flag +
// contest counts), the Leads Database (scoped per role), and lead detail with
// its attempt contest. Every read applies the CDPS permission matrix
// server-side; no writes happen here.
package module1_leads

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// TerminalAttemptStatuses returns the terminal attempt statuses (sorted). Single
// source of truth for the "open attempt" NOT IN filter used by the read model.
func TerminalAttemptStatuses() []string {
	out := make([]string, 0, len(terminalAttemptStatuses))
	for s := range terminalAttemptStatuses {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// notInTerminal builds a "NOT IN (?,?,...)" fragment and its args.
func notInTerminal() (string, []any) {
	terms := TerminalAttemptStatuses()
	ph := make([]string, len(terms))
	args := make([]any, len(terms))
	for i, t := range terms {
		ph[i] = "?"
		args[i] = t
	}
	return "NOT IN (" + strings.Join(ph, ",") + ")", args
}

// forbidden is the canonical 403 error (BI verbatim, mapped by writeDomainErr).
func forbidden() error { return &statemachine.RoleError{Message: statemachine.RoleDeniedMessage} }

// PoolRow is one Sales Pool board row (contract §3).
type PoolRow struct {
	ID               string    `json:"id"`
	LeadName         string    `json:"lead_name"`
	PhoneNumber      string    `json:"phone_number"`
	Source           string    `json:"source"`
	OriginCampaignID *string   `json:"origin_campaign_id"`
	CreatedAt        time.Time `json:"created_at"`
	Stale            bool      `json:"stale"`
	OpenAttemptCount int       `json:"open_attempt_count"`
	MyOpenAttempt    bool      `json:"my_open_attempt"`
}

// LeadRow is one Leads Database row (contract §4).
type LeadRow struct {
	ID                  string    `json:"id"`
	LeadName            string    `json:"lead_name"`
	PhoneNumber         string    `json:"phone_number"`
	Email               *string   `json:"email"`
	Source              string    `json:"source"`
	OriginDivision      string    `json:"origin_division"`
	OriginCampaignID    *string   `json:"origin_campaign_id"`
	LastTouchCampaignID *string   `json:"last_touch_campaign_id"`
	RecordStatus        string    `json:"record_status"`
	WinningAttemptID    *string   `json:"winning_attempt_id"`
	CreatedAt           time.Time `json:"created_at"`
	// CreatedBy is the employee who FIRST registered/imported this lead (the
	// original registrant; immutable). CreatedByNama resolves that id to a name
	// (falls back to the raw id when the employee is not yet synced from HRIS).
	CreatedBy        string `json:"created_by"`
	CreatedByNama    string `json:"created_by_nama"`
	OpenAttemptCount int    `json:"open_attempt_count"`
}

// LeadCore is the lead block of the detail view (LeadRow without the rollup).
type LeadCore struct {
	ID                  string    `json:"id"`
	LeadName            string    `json:"lead_name"`
	PhoneNumber         string    `json:"phone_number"`
	Email               *string   `json:"email"`
	Source              string    `json:"source"`
	OriginDivision      string    `json:"origin_division"`
	OriginCampaignID    *string   `json:"origin_campaign_id"`
	LastTouchCampaignID *string   `json:"last_touch_campaign_id"`
	RecordStatus        string    `json:"record_status"`
	WinningAttemptID    *string   `json:"winning_attempt_id"`
	CreatedAt           time.Time `json:"created_at"`
	// First registrant of the lead (see LeadRow.CreatedBy).
	CreatedBy     string `json:"created_by"`
	CreatedByNama string `json:"created_by_nama"`
}

// LeadAttemptRow is one attempt in the lead contest (contract §5).
type LeadAttemptRow struct {
	ID              string    `json:"id"`
	OwnerEmployeeID string    `json:"owner_employee_id"`
	OwnerNama       string    `json:"owner_nama"`
	Status          string    `json:"status"`
	ClaimedAt       time.Time `json:"claimed_at"`
}

// LeadDetail is the lead detail response (contract §5).
type LeadDetail struct {
	Lead     LeadCore         `json:"lead"`
	Attempts []LeadAttemptRow `json:"attempts"`
}

// canReadPool reports pool read access: Sales division (any level), OD, Director.
func canReadPool(actor permission.Actor) bool {
	return actor.Role.Director || actor.Role.OD || actor.Role.Division == SalesDivision
}

// Lead read scopes: which slice of the Leads Database an actor may see.
const (
	scopeAll            = "all"             // Marketing lead / Sales lead / OD / Director
	scopeMarketingStaff = "marketing_staff" // own leads: created_by OR owned-campaign origin
	scopeSalesStaff     = "sales_staff"     // own leads: registered by OR holding an attempt
)

// leadListScope reports whether actor may hit the Leads Database and, if so,
// which scope narrows the view. Marketing lead / Sales lead / OD / Director see
// all. Marketing staff see their own leads (created_by or owned-campaign
// origin). Sales staff see their own leads — the ones they registered
// (created_by) or hold a Prospect attempt on — never leads registered by other
// sales (M1 §9: Sales Staff "sees own attempts only"). Other divisions are
// denied.
func leadListScope(actor permission.Actor) (scope string, ok bool) {
	if actor.Role.Director || actor.Role.OD {
		return scopeAll, true
	}
	switch actor.Role.Division {
	case MarketingDivision:
		if actor.Role.Level == permission.LevelLead {
			return scopeAll, true
		}
		return scopeMarketingStaff, true
	case SalesDivision:
		if actor.Role.Level == permission.LevelLead {
			return scopeAll, true
		}
		return scopeSalesStaff, true
	}
	return "", false
}

// ListPool returns the Sales Pool board (contract §3).
func (s *Service) ListPool(ctx context.Context, actor permission.Actor) ([]PoolRow, error) {
	if !canReadPool(actor) {
		return nil, forbidden()
	}
	notIn, termArgs := notInTerminal()
	q := `SELECT l.id, l.lead_name, l.phone_number, l.source, l.origin_campaign_id, l.created_at,
	             (l.created_at < (NOW() - INTERVAL 24 HOUR)) AS stale,
	             (SELECT COUNT(*) FROM prospect_attempts pa
	               WHERE pa.lead_id = l.id AND pa.status ` + notIn + `) AS open_attempt_count,
	             EXISTS(SELECT 1 FROM prospect_attempts pa2
	               WHERE pa2.lead_id = l.id AND pa2.owner_employee_id = ? AND pa2.status ` + notIn + `) AS my_open_attempt
	        FROM leads l
	       WHERE l.record_status = '[Pool]'
	       ORDER BY l.created_at DESC, l.id DESC`
	args := make([]any, 0, len(termArgs)*2+1)
	args = append(args, termArgs...)      // open_attempt_count subquery
	args = append(args, actor.EmployeeID) // my_open_attempt owner
	args = append(args, termArgs...)      // my_open_attempt subquery
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PoolRow{}
	for rows.Next() {
		var r PoolRow
		var stale, mine int
		if err := rows.Scan(&r.ID, &r.LeadName, &r.PhoneNumber, &r.Source, nsScan(&r.OriginCampaignID),
			&r.CreatedAt, &stale, &r.OpenAttemptCount, &mine); err != nil {
			return nil, err
		}
		r.Stale = stale != 0
		r.MyOpenAttempt = mine != 0
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListLeads returns the scoped Leads Database (contract §4). q filters on
// lead_name/phone (LIKE); statusFilter is an exact record_status.
func (s *Service) ListLeads(ctx context.Context, actor permission.Actor, statusFilter, search string) ([]LeadRow, error) {
	scope, ok := leadListScope(actor)
	if !ok {
		return nil, forbidden()
	}
	notIn, termArgs := notInTerminal()
	q := `SELECT l.id, l.lead_name, l.phone_number, l.email, l.source, l.origin_division,
	             l.origin_campaign_id, l.last_touch_campaign_id, l.record_status, l.winning_attempt_id, l.created_at,
	             l.created_by, COALESCE(ce.nama, l.created_by),
	             (SELECT COUNT(*) FROM prospect_attempts pa
	               WHERE pa.lead_id = l.id AND pa.status ` + notIn + `) AS open_attempt_count
	        FROM leads l
	        LEFT JOIN employees ce ON ce.employee_id = l.created_by
	       WHERE 1 = 1`
	args := make([]any, 0)
	args = append(args, termArgs...)
	switch scope {
	case scopeMarketingStaff:
		q += ` AND (l.created_by = ? OR l.origin_campaign_id IN (SELECT id FROM campaigns WHERE owner_employee_id = ?))`
		args = append(args, actor.EmployeeID, actor.EmployeeID)
	case scopeSalesStaff:
		q += ` AND (l.created_by = ? OR EXISTS(SELECT 1 FROM prospect_attempts pa2
		             WHERE pa2.lead_id = l.id AND pa2.owner_employee_id = ?))`
		args = append(args, actor.EmployeeID, actor.EmployeeID)
	}
	if statusFilter != "" {
		q += ` AND l.record_status = ?`
		args = append(args, statusFilter)
	}
	if search != "" {
		like := "%" + search + "%"
		q += ` AND (l.lead_name LIKE ? OR l.phone_number LIKE ?)`
		args = append(args, like, like)
	}
	q += ` ORDER BY l.created_at DESC, l.id DESC`
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LeadRow{}
	for rows.Next() {
		var r LeadRow
		if err := rows.Scan(&r.ID, &r.LeadName, &r.PhoneNumber, nsScan(&r.Email), &r.Source, &r.OriginDivision,
			nsScan(&r.OriginCampaignID), nsScan(&r.LastTouchCampaignID), &r.RecordStatus,
			nsScan(&r.WinningAttemptID), &r.CreatedAt, &r.CreatedBy, &r.CreatedByNama, &r.OpenAttemptCount); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetLead returns a lead + its attempt contest (contract §5). Scope: whoever
// passes the Leads Database scope for THIS lead, OR a Sales actor who holds an
// attempt on it. ErrLeadNotFound when missing; 403 when out of scope.
func (s *Service) GetLead(ctx context.Context, actor permission.Actor, leadID string) (LeadDetail, error) {
	var d LeadDetail
	err := s.DB.QueryRowContext(ctx,
		`SELECT l.id, l.lead_name, l.phone_number, l.email, l.source, l.origin_division,
		        l.origin_campaign_id, l.last_touch_campaign_id, l.record_status, l.winning_attempt_id,
		        l.created_at, l.created_by, COALESCE(ce.nama, l.created_by)
		   FROM leads l
		   LEFT JOIN employees ce ON ce.employee_id = l.created_by
		  WHERE l.id = ?`, leadID).
		Scan(&d.Lead.ID, &d.Lead.LeadName, &d.Lead.PhoneNumber, nsScan(&d.Lead.Email), &d.Lead.Source,
			&d.Lead.OriginDivision, nsScan(&d.Lead.OriginCampaignID), nsScan(&d.Lead.LastTouchCampaignID),
			&d.Lead.RecordStatus, nsScan(&d.Lead.WinningAttemptID), &d.Lead.CreatedAt, &d.Lead.CreatedBy, &d.Lead.CreatedByNama)
	if err == sql.ErrNoRows {
		return LeadDetail{}, ErrLeadNotFound
	}
	if err != nil {
		return LeadDetail{}, err
	}

	var originCampaign sql.NullString
	if d.Lead.OriginCampaignID != nil {
		originCampaign = sql.NullString{String: *d.Lead.OriginCampaignID, Valid: true}
	}
	ok, err := s.canReadLead(ctx, actor, leadID, d.Lead.CreatedBy, originCampaign)
	if err != nil {
		return LeadDetail{}, err
	}
	if !ok {
		return LeadDetail{}, forbidden()
	}

	rows, err := s.DB.QueryContext(ctx,
		`SELECT pa.id, pa.owner_employee_id, COALESCE(e.nama, pa.owner_employee_id), pa.status, pa.claimed_at
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.lead_id = ? ORDER BY pa.created_at, pa.id`, leadID)
	if err != nil {
		return LeadDetail{}, err
	}
	defer rows.Close()
	d.Attempts = []LeadAttemptRow{}
	for rows.Next() {
		var a LeadAttemptRow
		if err := rows.Scan(&a.ID, &a.OwnerEmployeeID, &a.OwnerNama, &a.Status, &a.ClaimedAt); err != nil {
			return LeadDetail{}, err
		}
		d.Attempts = append(d.Attempts, a)
	}
	return d, rows.Err()
}

// canReadLead resolves the §5 detail read scope for one lead.
func (s *Service) canReadLead(ctx context.Context, actor permission.Actor, leadID, createdBy string, originCampaign sql.NullString) (bool, error) {
	scope, ok := leadListScope(actor)
	if ok {
		switch scope {
		case scopeAll:
			return true, nil // Marketing lead / Sales lead / OD / Director
		case scopeMarketingStaff:
			// Marketing staff: own lead (created_by) or an owned-campaign origin.
			if createdBy == actor.EmployeeID {
				return true, nil
			}
			if originCampaign.Valid {
				var owner string
				err := s.DB.QueryRowContext(ctx,
					`SELECT owner_employee_id FROM campaigns WHERE id = ?`, originCampaign.String).Scan(&owner)
				if err != nil && err != sql.ErrNoRows {
					return false, err
				}
				if err == nil && owner == actor.EmployeeID {
					return true, nil
				}
			}
		case scopeSalesStaff:
			// Sales staff: a lead they registered (created_by); an attempt they
			// hold is covered by the Sales-division check below.
			if createdBy == actor.EmployeeID {
				return true, nil
			}
		}
	}
	// A Sales actor (any level) may read a lead they hold an attempt on.
	if actor.Role.Division == SalesDivision {
		var n int
		if err := s.DB.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM prospect_attempts WHERE lead_id = ? AND owner_employee_id = ?`,
			leadID, actor.EmployeeID).Scan(&n); err != nil {
			return false, err
		}
		if n > 0 {
			return true, nil
		}
	}
	return false, nil
}

// nsScan copies a nullable SQL string into *dst, leaving dst nil for SQL NULL.
func nsScan(dst **string) any { return &nullStringPtr{dst} }

type nullStringPtr struct{ dst **string }

func (n *nullStringPtr) Scan(src any) error {
	if src == nil {
		*n.dst = nil
		return nil
	}
	var s string
	switch v := src.(type) {
	case []byte:
		s = string(v)
	case string:
		s = v
	default:
		var ns sql.NullString
		if err := ns.Scan(src); err != nil {
			return err
		}
		if !ns.Valid {
			*n.dst = nil
			return nil
		}
		s = ns.String
	}
	*n.dst = &s
	return nil
}
