// Package module4_client is Module 4 (Client Record). The client row and its
// provenance (platforms, sales allocation, services, transaction link) are
// INSERTed by Sales at closing (Module 0, W1-09) directly against the migration
// 0002 schema — this package is the READ/EDIT side that owns the record's
// lifecycle: provenance load (W1-10), the lock matrix (W1-11) and Void Service
// (W1-12).
//
// House rules honoured here:
//   - status columns move only through the state-machine engine (see void.go),
//   - IDs come only from ident.Next (this package mints none — closing does),
//   - every permitted edit appends an immutable audit row; nothing is deleted.
package module4_client

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CDPS divisions relevant to Module 4 visibility & the lock matrix.
const (
	SalesDivision   = "Sales"
	AccountDivision = "Account"
)

// Sentinel errors surfaced to the HTTP layer.
var (
	// ErrNotFound: the client does not exist OR is not visible to the actor
	// (M4 §6). Returning "not found" for an invisible-but-existing client keeps
	// pre-verification clients invisible to Account (M5 §5 Rule 2).
	ErrNotFound = errors.New("client not found")
	// ErrForbidden: the actor's role has no list/read access to Module 4 at all
	// (e.g. an execution-division staffer — they reach clients only via tasks in
	// Modules 6–10).
	ErrForbidden = errors.New("client access denied")
)

// Service is the M4 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
}

// Platform is one Client Platform sub-record (M4-OA-2: per-platform detail).
type Platform struct {
	Platform     string     `json:"platform"`
	StoreLink    string     `json:"store_link,omitempty"`
	ManagedSince *time.Time `json:"managed_since,omitempty"`
	Active       bool       `json:"active"`
}

// Allocation is one read-only Sales Allocation row (Σ basis_points = 10000).
type Allocation struct {
	SalespersonID string `json:"salesperson_id"`
	BasisPoints   int    `json:"basis_points"`
}

// ServiceLine is one closed Service (SVC-) in the immutable service set.
type ServiceLine struct {
	ID              string      `json:"id"`
	MasterServiceID string      `json:"master_service_id"`
	Name            string      `json:"name"`
	StandardPrice   money.Money `json:"-"`
	Status          string      `json:"status"`
}

// Client is the full canonical Client Record with its provenance.
type Client struct {
	ID                     string       `json:"id"`
	LeadID                 string       `json:"lead_id,omitempty"`
	WinningAttemptID       string       `json:"winning_attempt_id,omitempty"`
	NamaPIC                string       `json:"nama_pic"`
	Toko                   string       `json:"toko"`
	Kota                   string       `json:"kota"`
	LinkToko               string       `json:"link_toko"`
	Kategori               string       `json:"kategori"`
	GMVBaseline            money.Money  `json:"-"`
	TargetGMV              money.Money  `json:"-"`
	MarketingBudget        *money.Money `json:"-"`
	TotalSales             money.Money  `json:"-"`
	OriginCampaignID       string       `json:"origin_campaign_id,omitempty"`
	SalesPICID             string       `json:"sales_pic_id"`
	CommissionPaymentPICID string       `json:"commission_payment_pic_id"`
	TransactionID          string       `json:"transaction_id,omitempty"`
	PaymentIntent          string       `json:"payment_intent,omitempty"`
	ReleasedToAccountAt    *time.Time   `json:"released_to_account_at,omitempty"`
	CreatedAt              time.Time    `json:"created_at"`

	Platforms   []Platform    `json:"platforms"`
	Allocations []Allocation  `json:"sales_allocation"`
	Services    []ServiceLine `json:"services"`
}

// Get returns one client with full provenance, subject to visibility (M4 §6).
// A client the actor cannot see is reported as ErrNotFound; a role with no M4
// access at all gets ErrForbidden.
func (s *Service) Get(ctx context.Context, actor permission.Actor, id string) (Client, error) {
	clause, args, ok := visibility(actor)
	if !ok {
		return Client{}, ErrForbidden
	}
	q := selectClients + " WHERE c.id = ? AND (" + clause + ")"
	row := s.DB.QueryRowContext(ctx, q, append([]any{id}, args...)...)
	c, err := scanClient(row)
	if err == sql.ErrNoRows {
		return Client{}, ErrNotFound
	}
	if err != nil {
		return Client{}, err
	}
	if err := s.loadProvenance(ctx, &c); err != nil {
		return Client{}, err
	}
	return c, nil
}

// List returns every client visible to the actor (M4 §6), newest first, each
// with full provenance.
func (s *Service) List(ctx context.Context, actor permission.Actor) ([]Client, error) {
	clause, args, ok := visibility(actor)
	if !ok {
		return nil, ErrForbidden
	}
	q := selectClients + " WHERE " + clause + " ORDER BY c.id DESC"
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if err := s.loadProvenance(ctx, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// visibility builds the WHERE predicate for the clients a role may see (M4 §6).
// It returns ok=false for roles with no Module 4 list access.
//
//	OD / Director            -> all clients (OD read-only).
//	Sales Lead               -> all clients (all sales clients).
//	Sales Staff              -> own (sales_pic_id) OR a Sales-Allocation member.
//	Account Lead             -> all clients released to Account (M5 §5 Rule 2).
//	Account Staff (AM)       -> only released clients ASSIGNED to them (M6 §3).
//	other divisions          -> no list access.
//
// Account-staff "assigned clients" granularity (M4 §6 Rule 3) is now enforced:
// an AM (Account staff) sees only the released clients whose current AM pointer
// (clients.assigned_am_id, migration 0020) is them, while Account Lead/Head sees
// every released client. This pays off the W1-10 deferral (docs/DECISIONS.md
// 2026-07-10) once Module 6 AM assignment exists (W2-M6-C1). Pre-verification
// clients stay invisible to all of Account (released_to_account_at IS NULL).
func visibility(actor permission.Actor) (clause string, args []any, ok bool) {
	if actor.Role.Director || actor.Role.OD {
		return "1=1", nil, true
	}
	switch actor.Role.Division {
	case SalesDivision:
		if actor.Role.Level == permission.LevelLead {
			return "1=1", nil, true
		}
		return "(c.sales_pic_id = ? OR EXISTS (" +
				"SELECT 1 FROM client_sales_allocations a WHERE a.client_id = c.id AND a.salesperson_id = ?))",
			[]any{actor.EmployeeID, actor.EmployeeID}, true
	case AccountDivision:
		// Pre-verification clients are invisible to Account until the routing
		// gate stamps released_to_account_at (M5 §5 Rule 2; AC W1-13).
		if actor.Role.Level == permission.LevelLead {
			// Account Lead/Head sees all released account clients (M4 §6 Rule 3).
			return "c.released_to_account_at IS NOT NULL", nil, true
		}
		// Account Staff (AM) sees only released clients assigned to them
		// (M4 §6 Rule 3, M6 §3 Rule 2 — one AM owns the whole relationship).
		return "(c.released_to_account_at IS NOT NULL AND c.assigned_am_id = ?)",
			[]any{actor.EmployeeID}, true
	default:
		return "", nil, false
	}
}

const selectClients = `
SELECT c.id, c.lead_id, c.winning_attempt_id, c.nama_pic, c.toko, c.kota, c.link_toko,
       c.kategori, c.gmv_baseline, c.target_gmv, c.marketing_budget, c.total_sales,
       c.origin_campaign_id, c.sales_pic_id, c.commission_payment_pic_id, c.transaction_id,
       c.payment_intent, c.released_to_account_at, c.created_at
  FROM clients c`

// rowScanner is satisfied by *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanClient(r rowScanner) (Client, error) {
	var c Client
	var leadID, winAtt, originCmp, trxID, payIntent sql.NullString
	var mktBudget sql.NullString
	var gmvBaseline, targetGMV, totalSales string
	var released sql.NullTime
	if err := r.Scan(
		&c.ID, &leadID, &winAtt, &c.NamaPIC, &c.Toko, &c.Kota, &c.LinkToko,
		&c.Kategori, &gmvBaseline, &targetGMV, &mktBudget, &totalSales,
		&originCmp, &c.SalesPICID, &c.CommissionPaymentPICID, &trxID,
		&payIntent, &released, &c.CreatedAt,
	); err != nil {
		return Client{}, err
	}
	var err error
	if c.GMVBaseline, err = money.Parse(gmvBaseline); err != nil {
		return Client{}, err
	}
	if c.TargetGMV, err = money.Parse(targetGMV); err != nil {
		return Client{}, err
	}
	if c.TotalSales, err = money.Parse(totalSales); err != nil {
		return Client{}, err
	}
	if mktBudget.Valid {
		m, err := money.Parse(mktBudget.String)
		if err != nil {
			return Client{}, err
		}
		c.MarketingBudget = &m
	}
	c.LeadID = leadID.String
	c.WinningAttemptID = winAtt.String
	c.OriginCampaignID = originCmp.String
	c.TransactionID = trxID.String
	c.PaymentIntent = payIntent.String
	if released.Valid {
		c.ReleasedToAccountAt = &released.Time
	}
	return c, nil
}

func (s *Service) loadProvenance(ctx context.Context, c *Client) error {
	c.Platforms = []Platform{}
	c.Allocations = []Allocation{}
	c.Services = []ServiceLine{}

	prows, err := s.DB.QueryContext(ctx,
		`SELECT platform, store_link, managed_since, active FROM client_platforms WHERE client_id = ? ORDER BY id`, c.ID)
	if err != nil {
		return err
	}
	defer prows.Close()
	for prows.Next() {
		var p Platform
		var link sql.NullString
		var since sql.NullTime
		var active int
		if err := prows.Scan(&p.Platform, &link, &since, &active); err != nil {
			return err
		}
		p.StoreLink = link.String
		if since.Valid {
			p.ManagedSince = &since.Time
		}
		p.Active = active != 0
		c.Platforms = append(c.Platforms, p)
	}
	if err := prows.Err(); err != nil {
		return err
	}

	arows, err := s.DB.QueryContext(ctx,
		`SELECT salesperson_id, basis_points FROM client_sales_allocations WHERE client_id = ? ORDER BY id`, c.ID)
	if err != nil {
		return err
	}
	defer arows.Close()
	for arows.Next() {
		var a Allocation
		if err := arows.Scan(&a.SalespersonID, &a.BasisPoints); err != nil {
			return err
		}
		c.Allocations = append(c.Allocations, a)
	}
	if err := arows.Err(); err != nil {
		return err
	}

	srows, err := s.DB.QueryContext(ctx,
		`SELECT id, master_service_id, name, standard_price, status FROM services WHERE client_id = ? ORDER BY id`, c.ID)
	if err != nil {
		return err
	}
	defer srows.Close()
	for srows.Next() {
		var sl ServiceLine
		var price string
		if err := srows.Scan(&sl.ID, &sl.MasterServiceID, &sl.Name, &price, &sl.Status); err != nil {
			return err
		}
		if sl.StandardPrice, err = money.Parse(price); err != nil {
			return err
		}
		c.Services = append(c.Services, sl)
	}
	return srows.Err()
}
