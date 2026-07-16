// read.go — Module 0 read layer (Sales Workspace v1). Read-only projections of a
// salesperson's worklist (GET /my/attempts) and one attempt's full detail
// (GET /attempts/{id}) including its Qualified Form snapshot and negotiation
// versions. NO mutation, NO status write, NO audit row.
//
// Money values are returned as core/money.Money so the httpapi layer can render
// both the raw decimal and the house IDR string side by side (`*_idr`).
package module0_sales

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// ErrReadDenied denies an attempt-detail read (Marketing / non-owner Sales
// staff). Same existing read-access BI string as module1_leads.ErrLeadForbidden;
// httpapi.writeDomainErr maps it to 403 verbatim.
var ErrReadDenied = errors.New("[anda tidak memiliki akses ke data ini]")

// MyAttemptItem is one row of a salesperson's worklist.
type MyAttemptItem struct {
	ID          string
	LeadID      string
	LeadName    string
	PhoneNumber string
	Status      string
	CreatedAt   time.Time
}

// AttemptRow is the attempt header in the detail view.
type AttemptRow struct {
	ID        string
	LeadID    string
	OwnerID   string
	OwnerName string
	Status    string
	CreatedAt time.Time
}

// LeadRow is the lead summary in the detail view.
type LeadRow struct {
	ID           string
	LeadName     string
	PhoneNumber  string
	RecordStatus string
}

// QualifiedServiceDetail is one selected service on the Qualified Form.
type QualifiedServiceDetail struct {
	MasterServiceID string
	Name            string
	StandardPrice   money.Money
	CommissionRule  string
}

// QualifiedFormDetail mirrors the qualified_forms row (+ its service lines).
type QualifiedFormDetail struct {
	NamaPIC         string
	Toko            string
	Kota            string
	LinkToko        string
	Kategori        string
	Platform        string
	StoreLink       string
	GMVBaseline     money.Money
	TargetGMV       money.Money
	MarketingBudget *money.Money
	Services        []QualifiedServiceDetail
}

// NegotiationLine is one proposed service line of a proposal version.
type NegotiationLine struct {
	MasterServiceID string
	ProposedPrice   money.Money
	CommissionRule  string
	PaymentTerms    *string
}

// NegotiationVersion is one immutable proposal version.
type NegotiationVersion struct {
	ID           string
	VersionNo    int
	ProposedBy   string
	DecisionNote *string
	CreatedAt    time.Time
	Lines        []NegotiationLine
}

// NegotiationDetail wraps the ordered proposal versions.
type NegotiationDetail struct {
	Versions []NegotiationVersion
}

// AttemptDetail is the full read model for GET /attempts/{id}.
type AttemptDetail struct {
	Attempt     AttemptRow
	Lead        LeadRow
	Qualified   *QualifiedFormDetail
	Negotiation *NegotiationDetail
}

// MyAttempts returns every attempt owned by the actor, non-terminal first, then
// created_at DESC. Own-data only, so no role gate beyond authentication (OD /
// Director see their own attempts too — usually none).
func (s *Service) MyAttempts(ctx context.Context, actor permission.Actor) ([]MyAttemptItem, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT pa.id, pa.lead_id, l.lead_name, l.phone_number, pa.status, pa.created_at
		   FROM prospect_attempts pa
		   JOIN leads l ON l.id = pa.lead_id
		  WHERE pa.owner_employee_id = ?
		  ORDER BY pa.created_at DESC, pa.id DESC`, actor.EmployeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MyAttemptItem
	for rows.Next() {
		var it MyAttemptItem
		if err := rows.Scan(&it.ID, &it.LeadID, &it.LeadName, &it.PhoneNumber, &it.Status, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Non-terminal attempts float to the top (worklist priority), created_at DESC
	// preserved within each partition (stable).
	stableSortNonTerminalFirst(out)
	return out, nil
}

// stableSortNonTerminalFirst partitions non-terminal attempts before terminal
// ones without disturbing the created_at DESC order the query already applied.
func stableSortNonTerminalFirst(items []MyAttemptItem) {
	// Simple stable insertion of terminal items after non-terminal ones.
	nonTerminal := make([]MyAttemptItem, 0, len(items))
	terminal := make([]MyAttemptItem, 0, len(items))
	for _, it := range items {
		if IsTerminalAttemptStatus(it.Status) {
			terminal = append(terminal, it)
		} else {
			nonTerminal = append(nonTerminal, it)
		}
	}
	copy(items, nonTerminal)
	copy(items[len(nonTerminal):], terminal)
}

// IsTerminalAttemptStatus reports whether a prospect-attempt status is terminal.
// Mirrors the prospect_attempt machine's terminal set (M0/M1 §1).
func IsTerminalAttemptStatus(status string) bool {
	switch status {
	case StatusNotQualified, StatusClosedSuccess, StatusClosedLost, StatusClosedKalah, "Blocked":
		return true
	default:
		return false
	}
}

// canReadAttempt applies the GET /attempts/{id} visibility rule: owner; Sales
// Lead/SPV; OD (read); Director. Marketing (and any other non-owner) is denied.
func canReadAttempt(actor permission.Actor, ownerID string) bool {
	if actor.Role.Director || actor.Role.OD {
		return true
	}
	if actor.EmployeeID == ownerID {
		return true
	}
	return actor.Role.Division == SalesDivision && actor.Role.Level == permission.LevelLead
}

// AttemptDetailFor loads the full attempt detail after enforcing visibility. A
// missing attempt is ErrNotFound; a forbidden one is a blockedError carrying the
// shared BI access-denial string (mapped to 403 by httpapi.writeDomainErr).
func (s *Service) AttemptDetailFor(ctx context.Context, actor permission.Actor, attemptID string) (AttemptDetail, error) {
	var d AttemptDetail
	err := s.DB.QueryRowContext(ctx,
		`SELECT pa.id, pa.lead_id, pa.owner_employee_id, COALESCE(e.nama, ''), pa.status, pa.created_at,
		        l.lead_name, l.phone_number, l.record_status
		   FROM prospect_attempts pa
		   JOIN leads l ON l.id = pa.lead_id
		   LEFT JOIN employees e ON e.employee_id = pa.owner_employee_id
		  WHERE pa.id = ?`, attemptID).
		Scan(&d.Attempt.ID, &d.Attempt.LeadID, &d.Attempt.OwnerID, &d.Attempt.OwnerName,
			&d.Attempt.Status, &d.Attempt.CreatedAt,
			&d.Lead.LeadName, &d.Lead.PhoneNumber, &d.Lead.RecordStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return AttemptDetail{}, ErrNotFound
	}
	if err != nil {
		return AttemptDetail{}, err
	}
	d.Lead.ID = d.Attempt.LeadID

	if !canReadAttempt(actor, d.Attempt.OwnerID) {
		return AttemptDetail{}, ErrReadDenied
	}

	qf, err := loadQualifiedFormDetail(ctx, s.DB, attemptID)
	if err != nil {
		return AttemptDetail{}, err
	}
	d.Qualified = qf

	neg, err := loadNegotiationDetail(ctx, s.DB, attemptID)
	if err != nil {
		return AttemptDetail{}, err
	}
	d.Negotiation = neg
	return d, nil
}

func loadQualifiedFormDetail(ctx context.Context, db *sql.DB, attemptID string) (*QualifiedFormDetail, error) {
	var qf QualifiedFormDetail
	var storeLink, budget sql.NullString
	var gmvBaseline, targetGMV string
	err := db.QueryRowContext(ctx,
		`SELECT nama_pic, toko, kota, link_toko, kategori, platform, store_link,
		        gmv_baseline, target_gmv, marketing_budget
		   FROM qualified_forms WHERE attempt_id = ?`, attemptID).
		Scan(&qf.NamaPIC, &qf.Toko, &qf.Kota, &qf.LinkToko, &qf.Kategori, &qf.Platform, &storeLink,
			&gmvBaseline, &targetGMV, &budget)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storeLink.Valid {
		qf.StoreLink = storeLink.String
	}
	if qf.GMVBaseline, err = money.Parse(gmvBaseline); err != nil {
		return nil, err
	}
	if qf.TargetGMV, err = money.Parse(targetGMV); err != nil {
		return nil, err
	}
	if budget.Valid {
		mb, err := money.Parse(budget.String)
		if err != nil {
			return nil, err
		}
		qf.MarketingBudget = &mb
	}

	rows, err := db.QueryContext(ctx,
		`SELECT master_service_id, name, standard_price, commission_rule
		   FROM qualified_form_services WHERE attempt_id = ? ORDER BY id`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var svc QualifiedServiceDetail
		var price string
		if err := rows.Scan(&svc.MasterServiceID, &svc.Name, &price, &svc.CommissionRule); err != nil {
			return nil, err
		}
		if svc.StandardPrice, err = money.Parse(price); err != nil {
			return nil, err
		}
		qf.Services = append(qf.Services, svc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &qf, nil
}

func loadNegotiationDetail(ctx context.Context, db *sql.DB, attemptID string) (*NegotiationDetail, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, version_no, proposed_by, decision_note, created_at
		   FROM negotiation_proposals WHERE attempt_id = ? ORDER BY version_no ASC`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var versions []NegotiationVersion
	for rows.Next() {
		var v NegotiationVersion
		var note sql.NullString
		if err := rows.Scan(&v.ID, &v.VersionNo, &v.ProposedBy, &note, &v.CreatedAt); err != nil {
			return nil, err
		}
		if note.Valid {
			n := note.String
			v.DecisionNote = &n
		}
		versions = append(versions, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(versions) == 0 {
		return nil, nil
	}
	for i := range versions {
		lines, err := loadNegotiationLines(ctx, db, versions[i].ID)
		if err != nil {
			return nil, err
		}
		versions[i].Lines = lines
	}
	return &NegotiationDetail{Versions: versions}, nil
}

func loadNegotiationLines(ctx context.Context, db *sql.DB, proposalID string) ([]NegotiationLine, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT master_service_id, proposed_price, commission_rule, payment_terms
		   FROM negotiation_proposal_lines WHERE proposal_id = ? ORDER BY id`, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NegotiationLine
	for rows.Next() {
		var l NegotiationLine
		var price string
		var terms sql.NullString
		if err := rows.Scan(&l.MasterServiceID, &price, &l.CommissionRule, &terms); err != nil {
			return nil, err
		}
		if l.ProposedPrice, err = money.Parse(price); err != nil {
			return nil, err
		}
		if terms.Valid {
			t := terms.String
			l.PaymentTerms = &t
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
