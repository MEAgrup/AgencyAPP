// reads.go — M0 Sales read model (scoped list + detail) and the Closed-Lost
// write edge. Every read applies the M0 §9.1 permission matrix server-side
// (Staff = own attempts; Sales Lead = division-wide; OD = read-only everywhere;
// Director = full). No status is written here except MarkLost, which routes
// through the transition engine (house rule 2 — the engine blocks illegal edges
// with the verbatim BI message).
package module0_sales

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// AttemptRow is a scoped attempt-list row (contract §1).
type AttemptRow struct {
	ID              string    `json:"id"`
	LeadID          string    `json:"lead_id"`
	LeadName        string    `json:"lead_name"`
	PhoneNumber     string    `json:"phone_number"`
	Source          string    `json:"source"`
	OwnerEmployeeID string    `json:"owner_employee_id"`
	OwnerNama       string    `json:"owner_nama"`
	Status          string    `json:"status"`
	ClaimedAt       time.Time `json:"claimed_at"`
	CreatedAt       time.Time `json:"created_at"`
}

// AttemptCore is the attempt block of the detail view (contract §2).
type AttemptCore struct {
	ID              string    `json:"id"`
	LeadID          string    `json:"lead_id"`
	OwnerEmployeeID string    `json:"owner_employee_id"`
	OwnerNama       string    `json:"owner_nama"`
	Status          string    `json:"status"`
	ClaimedAt       time.Time `json:"claimed_at"`
	CreatedAt       time.Time `json:"created_at"`
}

// LeadCore is the lead block of the detail view.
type LeadCore struct {
	ID                  string  `json:"id"`
	LeadName            string  `json:"lead_name"`
	PhoneNumber         string  `json:"phone_number"`
	Email               *string `json:"email"`
	Source              string  `json:"source"`
	RecordStatus        string  `json:"record_status"`
	OriginCampaignID    *string `json:"origin_campaign_id"`
	LastTouchCampaignID *string `json:"last_touch_campaign_id"`
	WinningAttemptID    *string `json:"winning_attempt_id"`
}

// QualifiedFormView is the persisted Qualified Form + its pinned service lines.
type QualifiedFormView struct {
	NamaPIC         string          `json:"nama_pic"`
	Toko            string          `json:"toko"`
	Kota            string          `json:"kota"`
	LinkToko        string          `json:"link_toko"`
	Kategori        string          `json:"kategori"`
	Platform        string          `json:"platform"`
	StoreLink       *string         `json:"store_link"`
	GMVBaseline     string          `json:"gmv_baseline"`
	TargetGMV       string          `json:"target_gmv"`
	MarketingBudget *string         `json:"marketing_budget"`
	Services        []QFServiceView `json:"services"`
}

// QFServiceView is one pinned Qualified-Form service line (money as-is string).
type QFServiceView struct {
	MasterServiceID string  `json:"master_service_id"`
	MasterVersionNo int     `json:"master_version_no"`
	Name            string  `json:"name"`
	Quantity        string  `json:"quantity"`
	Unit            *string `json:"unit"`
	PricingMode     string  `json:"pricing_mode"`
	StandardPrice   string  `json:"standard_price"`
	InputAmount     *string `json:"input_amount"`
	Subtotal        string  `json:"subtotal"`
	CommissionRule  string  `json:"commission_rule"`
}

// ProposalView is one immutable negotiation version + its lines.
type ProposalView struct {
	ID             string             `json:"id"`
	VersionNo      int                `json:"version_no"`
	ProposedBy     string             `json:"proposed_by"`
	ProposedByNama string             `json:"proposed_by_nama"`
	DecisionNote   *string            `json:"decision_note"`
	CreatedAt      time.Time          `json:"created_at"`
	Lines          []ProposalLineView `json:"lines"`
}

// ProposalLineView is one negotiated line; name resolved from the Qualified Form.
type ProposalLineView struct {
	MasterServiceID string  `json:"master_service_id"`
	Name            string  `json:"name"`
	ProposedPrice   string  `json:"proposed_price"`
	CommissionRule  string  `json:"commission_rule"`
	PaymentTerms    *string `json:"payment_terms"`
}

// AttemptDetail is the full attempt detail response (contract §2).
type AttemptDetail struct {
	Attempt            AttemptCore        `json:"attempt"`
	Lead               LeadCore           `json:"lead"`
	QualifiedForm      *QualifiedFormView `json:"qualified_form"`
	Proposals          []ProposalView     `json:"proposals"`
	NQReasons          []string           `json:"nq_reasons"`
	AllowedTransitions []string           `json:"allowed_transitions"`
}

// readDeniedMessage is the canonical generic data-access denial string
// (DECISIONS 2026-07-17 W3-M3-C1: reuse, no module-specific wording) — the
// transition-specific RoleDeniedMessage stays reserved for write transitions.
const readDeniedMessage = "[anda tidak memiliki akses ke data ini]"

// forbidden is the canonical 403 error for reads (BI verbatim, mapped by writeDomainErr).
func forbidden() error { return &statemachine.RoleError{Message: readDeniedMessage} }

// canListAttempts reports whether actor may hit the attempt list at all and, if
// so, whether the view is unscoped (all) or narrowed to the actor's own rows.
func canListAttempts(actor permission.Actor) (all bool, ok bool) {
	if actor.Role.Director || actor.Role.OD {
		return true, true
	}
	if actor.Role.Division == SalesDivision {
		if actor.Role.Level == permission.LevelLead {
			return true, true
		}
		return false, true // Sales staff: own attempts only
	}
	return false, false
}

// canReadAttempt applies the §2 detail read scope: owner, Sales lead, OD, Director.
func canReadAttempt(actor permission.Actor, ownerID string) bool {
	if actor.Role.Director || actor.Role.OD {
		return true
	}
	if actor.Role.Division == SalesDivision {
		if actor.Role.Level == permission.LevelLead {
			return true
		}
		return actor.EmployeeID == ownerID
	}
	return false
}

// ListAttempts returns the scoped attempt list (contract §1). statusFilter, when
// non-empty, restricts to an exact status.
func (s *Service) ListAttempts(ctx context.Context, actor permission.Actor, statusFilter string) ([]AttemptRow, error) {
	all, ok := canListAttempts(actor)
	if !ok {
		return nil, forbidden()
	}
	q := `SELECT pa.id, pa.lead_id, l.lead_name, l.phone_number, l.source,
	              pa.owner_employee_id, COALESCE(e.nama, pa.owner_employee_id),
	              pa.status, pa.claimed_at, pa.created_at
	         FROM prospect_attempts pa
	         JOIN leads l ON l.id = pa.lead_id
	         LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
	        WHERE 1 = 1`
	var args []any
	if !all {
		q += ` AND pa.owner_employee_id = ?`
		args = append(args, actor.EmployeeID)
	}
	if statusFilter != "" {
		q += ` AND pa.status = ?`
		args = append(args, statusFilter)
	}
	q += ` ORDER BY pa.created_at DESC, pa.id DESC`

	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AttemptRow{}
	for rows.Next() {
		var r AttemptRow
		if err := rows.Scan(&r.ID, &r.LeadID, &r.LeadName, &r.PhoneNumber, &r.Source,
			&r.OwnerEmployeeID, &r.OwnerNama, &r.Status, &r.ClaimedAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetAttempt returns the full attempt detail (contract §2). Returns ErrNotFound
// when the attempt is missing and a 403 error when the actor is out of scope.
func (s *Service) GetAttempt(ctx context.Context, actor permission.Actor, attemptID string) (AttemptDetail, error) {
	var d AttemptDetail
	err := s.DB.QueryRowContext(ctx,
		`SELECT pa.id, pa.lead_id, pa.owner_employee_id, COALESCE(e.nama, pa.owner_employee_id),
		        pa.status, pa.claimed_at, pa.created_at
		   FROM prospect_attempts pa
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.id = ?`, attemptID).
		Scan(&d.Attempt.ID, &d.Attempt.LeadID, &d.Attempt.OwnerEmployeeID, &d.Attempt.OwnerNama,
			&d.Attempt.Status, &d.Attempt.ClaimedAt, &d.Attempt.CreatedAt)
	if err == sql.ErrNoRows {
		return AttemptDetail{}, ErrNotFound
	}
	if err != nil {
		return AttemptDetail{}, err
	}
	if !canReadAttempt(actor, d.Attempt.OwnerEmployeeID) {
		return AttemptDetail{}, forbidden()
	}

	if err := s.DB.QueryRowContext(ctx,
		`SELECT id, lead_name, phone_number, email, source, record_status,
		        origin_campaign_id, last_touch_campaign_id, winning_attempt_id
		   FROM leads WHERE id = ?`, d.Attempt.LeadID).
		Scan(&d.Lead.ID, &d.Lead.LeadName, &d.Lead.PhoneNumber, nsScan(&d.Lead.Email), &d.Lead.Source,
			&d.Lead.RecordStatus, nsScan(&d.Lead.OriginCampaignID), nsScan(&d.Lead.LastTouchCampaignID),
			nsScan(&d.Lead.WinningAttemptID)); err != nil {
		return AttemptDetail{}, err
	}

	qf, err := s.loadQualifiedForm(ctx, attemptID)
	if err != nil {
		return AttemptDetail{}, err
	}
	d.QualifiedForm = qf

	proposals, err := s.loadProposals(ctx, attemptID)
	if err != nil {
		return AttemptDetail{}, err
	}
	d.Proposals = proposals

	reasons, err := s.loadNQReasons(ctx, attemptID)
	if err != nil {
		return AttemptDetail{}, err
	}
	d.NQReasons = reasons

	d.AllowedTransitions = []string{}
	if m, ok := s.Engine.Machine(statemachine.MProspectAttempt); ok {
		if allowed := m.AllowedFrom(d.Attempt.Status); allowed != nil {
			d.AllowedTransitions = allowed
		}
	}
	return d, nil
}

func (s *Service) loadQualifiedForm(ctx context.Context, attemptID string) (*QualifiedFormView, error) {
	var qf QualifiedFormView
	err := s.DB.QueryRowContext(ctx,
		`SELECT nama_pic, toko, kota, link_toko, kategori, platform, store_link,
		        gmv_baseline, target_gmv, marketing_budget
		   FROM qualified_forms WHERE attempt_id = ?`, attemptID).
		Scan(&qf.NamaPIC, &qf.Toko, &qf.Kota, &qf.LinkToko, &qf.Kategori, &qf.Platform,
			nsScan(&qf.StoreLink), &qf.GMVBaseline, &qf.TargetGMV, nsScan(&qf.MarketingBudget))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT master_service_id, master_version_no, name, quantity, unit, pricing_mode,
		        standard_price, input_amount, subtotal, commission_rule
		   FROM qualified_form_services WHERE attempt_id = ? ORDER BY id`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	qf.Services = []QFServiceView{}
	for rows.Next() {
		var l QFServiceView
		if err := rows.Scan(&l.MasterServiceID, &l.MasterVersionNo, &l.Name, &l.Quantity,
			nsScan(&l.Unit), &l.PricingMode, &l.StandardPrice, nsScan(&l.InputAmount),
			&l.Subtotal, &l.CommissionRule); err != nil {
			return nil, err
		}
		qf.Services = append(qf.Services, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &qf, nil
}

func (s *Service) loadProposals(ctx context.Context, attemptID string) ([]ProposalView, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT np.id, np.version_no, np.proposed_by, COALESCE(e.nama, np.proposed_by),
		        np.decision_note, np.created_at
		   FROM negotiation_proposals np
		   LEFT JOIN employees e ON e.employee_id = np.proposed_by
		  WHERE np.attempt_id = ? ORDER BY np.version_no ASC`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProposalView{}
	for rows.Next() {
		var p ProposalView
		if err := rows.Scan(&p.ID, &p.VersionNo, &p.ProposedBy, &p.ProposedByNama,
			nsScan(&p.DecisionNote), &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		lines, err := s.loadProposalLines(ctx, attemptID, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Lines = lines
	}
	return out, nil
}

func (s *Service) loadProposalLines(ctx context.Context, attemptID, proposalID string) ([]ProposalLineView, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT npl.master_service_id, COALESCE(qfs.name, ''), npl.proposed_price,
		        npl.commission_rule, npl.payment_terms
		   FROM negotiation_proposal_lines npl
		   LEFT JOIN qualified_form_services qfs
		     ON qfs.attempt_id = ? AND qfs.master_service_id = npl.master_service_id
		  WHERE npl.proposal_id = ? ORDER BY npl.id`, attemptID, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProposalLineView{}
	for rows.Next() {
		var l ProposalLineView
		if err := rows.Scan(&l.MasterServiceID, &l.Name, &l.ProposedPrice,
			&l.CommissionRule, nsScan(&l.PaymentTerms)); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Service) loadNQReasons(ctx context.Context, attemptID string) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT reason FROM prospect_attempt_nq_reasons WHERE attempt_id = ? ORDER BY id`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MarkLost closes an attempt as Closed-Lost (contract §6). Owner / Sales Lead /
// Director only; the prospect_attempt machine blocks illegal edges (e.g. from a
// pre-negotiation status) with the verbatim BI message.
func (s *Service) MarkLost(ctx context.Context, actor permission.Actor, attemptID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return &blockedError{msgDenied}
	}
	if err := s.transition(ctx, tx, attemptID, StatusClosedLost, actor); err != nil {
		return err
	}
	return tx.Commit()
}

// nsScan returns a scan target that copies a nullable SQL string into *dst,
// leaving dst nil for SQL NULL (so the JSON field renders null, not "").
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
