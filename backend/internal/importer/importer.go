// Package importer is the W1-19 one-time go-live migration engine: it takes
// EXISTING operational data (leads still in-flight, clients already closed before
// CDPS) as typed rows and lands them in CDPS through the SAME domain paths a
// live user would, never by raw INSERT of business state.
//
// Scope (DECISIONS O6): the spreadsheet-shape PARSER is built AFTER the sample
// arrives. This package is everything BELOW that parser — it accepts typed input
// structs (the "minimum columns" contract of docs/handoff/WAVE1_EXTERNAL_REQUESTS.md
// Permintaan #3). The eventual parser is a thin adapter: file bytes -> these
// structs -> DryRun/Apply.
//
// Two data groups, two entry paths (Permintaan #3):
//   - LeadRow  -> the Module 1 dedup engine (module1_leads.Decide): normalize
//     phone, run the registration-door decision table (active dup blocked with the
//     verbatim BI message; Rejected/Not-Qualified reopened to [Pool]).
//   - ClientRow -> a full closed client rebuilt as CLI-/SVC-/TRX-/INST- against
//     the 0002 schema, then verified payments REPLAYED through
//     module5_finance.Verify so payment status, the verification log and the
//     routing gate (release-to-Account) all fire through the official path.
//
// House rules honoured (CLAUDE.md): IDs only via ident.Next after validation;
// status columns only via the state-machine engine or a birth-insert of the
// initial status; audit is append-only (every landed entity carries an
// `import:*` provenance row with its source row index); derived money fields are
// never written, only recomputed from the log.
//
// This package does NOT edit any other package — it composes their exported APIs.
package importer

import (
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// ErrForbidden: import is a go-live operation reserved to Director (Apply and
// DryRun alike touch the whole dataset). Reuses the engine's role-denied BI
// message rather than inventing one.
var ErrForbidden = errors.New(statemachine.RoleDeniedMessage)

// Row-outcome statuses. Dry-run classifies each row as valid/duplikat/error;
// Apply classifies each as applied/duplikat/gagal. "duplikat" is shared: a lead
// blocked by the dedup engine (never a hard failure of the import process).
const (
	RowValid    = "valid"    // dry-run: row will import (fresh create or reopen)
	RowDuplikat = "duplikat" // dedup engine blocked this lead
	RowError    = "error"    // dry-run: validation/DB error, row will NOT import
	RowApplied  = "applied"  // apply: row landed (create or reopen)
	RowFailed   = "gagal"    // apply: row failed and was rolled back utuh
)

// RowOutcome is the per-row verdict. Message carries an engine-sourced BI string
// (blocks/validation errors); Detail carries neutral, non-BI provenance notes
// (e.g. the reopened lead id). IssuedIDs is populated by Apply.
type RowOutcome struct {
	Index     int      `json:"index"`  // 0-based index within its input slice
	Entity    string   `json:"entity"` // "lead" | "client"
	Status    string   `json:"status"`
	Message   string   `json:"message,omitempty"`
	Detail    string   `json:"detail,omitempty"`
	IssuedIDs []string `json:"issued_ids,omitempty"`
}

// Report is the full dry-run / apply result with reconciliation counts.
type Report struct {
	Rows []RowOutcome `json:"rows"`

	Total    int `json:"total"`
	Valid    int `json:"valid"`    // dry-run
	Duplikat int `json:"duplikat"` // dry-run + apply
	Error    int `json:"error"`    // dry-run
	Applied  int `json:"applied"`  // apply
	Failed   int `json:"failed"`   // apply
}

func (r *Report) add(o RowOutcome) { r.Rows = append(r.Rows, o) }

// recount derives the reconciliation totals from the per-row statuses so the
// counts can never drift from the rows.
func (r *Report) recount() {
	r.Total = len(r.Rows)
	r.Valid, r.Duplikat, r.Error, r.Applied, r.Failed = 0, 0, 0, 0, 0
	for _, o := range r.Rows {
		switch o.Status {
		case RowValid:
			r.Valid++
		case RowDuplikat:
			r.Duplikat++
		case RowError:
			r.Error++
		case RowApplied:
			r.Applied++
		case RowFailed:
			r.Failed++
		}
	}
}

// Service is the importer surface. It composes the finance service (built from
// the same DB+Engine) for the payment replay path.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
}

func (s *Service) finance() *module5_finance.Service {
	return &module5_finance.Service{DB: s.DB, Engine: s.Engine}
}

// ─────────────────────────────────────────────────────────────────────────────
// Input structs — the "minimum columns" contract (Permintaan #3).
// ─────────────────────────────────────────────────────────────────────────────

// LeadRow is one existing (not-yet-closed) lead. Email/CampaignAsal/SalesPemegang/
// Catatan are optional. StatusTerakhir is one of: pool | diproses | not-qualified
// | rejected (empty defaults to pool).
type LeadRow struct {
	NamaLead       string
	NoTelepon      string
	Email          string
	Sumber         string
	CampaignAsal   string
	SalesPemegang  string // employee_id currently working the lead (optional)
	StatusTerakhir string
	Catatan        string
}

// PlatformRow is one client platform sub-record (M4-OA-2).
type PlatformRow struct {
	Platform     string
	Link         string
	TanggalMulai *time.Time // managed_since (optional)
}

// AllocationRow is one salesperson's share, in basis points (100% == 10000).
// The parser converts a spreadsheet "50%" to 5000; the DB unit is basis points.
type AllocationRow struct {
	SalespersonID string
	BasisPoints   int
}

// ServiceRow is one purchased service line (name + deal price). Legacy imported
// services have no Master Service List linkage — see createClientTx.
type ServiceRow struct {
	Nama      string
	HargaDeal money.Money
}

// TerminRow is one scheduled installment (amount + due date).
type TerminRow struct {
	Amount  money.Money
	DueDate time.Time
}

// PaymentRow is one already-verified payment (amount + date) to replay.
type PaymentRow struct {
	Amount  money.Money
	Tanggal time.Time
}

// ClientRow is one active client already closed before CDPS.
type ClientRow struct {
	Toko                    string
	NamaPIC                 string
	Kota                    string
	LinkToko                string
	Kategori                string
	Platforms               []PlatformRow
	GMVBaselineBulanan      money.Money
	TargetGMV               money.Money
	MarketingBudget         *money.Money
	SalesPIC                string
	AlokasiSales            []AllocationRow
	CommissionPaymentPIC    string
	TanggalClosing          time.Time
	Layanan                 []ServiceRow
	NilaiTransaksiTotal     money.Money
	SkemaPembayaran         string
	// JadwalTermin and PembayaranTerverifikasi are POSITIONALLY mapped for
	// scheduled schemes (Termin / Bayar di Belakang): PembayaranTerverifikasi[i]
	// settles JadwalTermin[i] (validated to match its amount, in order). Payments
	// must be listed in schedule order with non-decreasing dates.
	JadwalTermin            []TerminRow
	PembayaranTerverifikasi []PaymentRow
	LinkKontrak             string
}

// closingParties adapts a ClientRow's sales side to the M0 allocation validator,
// reusing its Σ=100% / max-5 / member rules and BI messages (no reimplementation).
func (r ClientRow) closingParties() module0_sales.ClosingParties {
	allocs := make([]module0_sales.Allocation, len(r.AlokasiSales))
	for i, a := range r.AlokasiSales {
		allocs[i] = module0_sales.Allocation{SalespersonID: a.SalespersonID, BasisPoints: a.BasisPoints}
	}
	return module0_sales.ClosingParties{
		PrimarySalespersonID:   r.SalesPIC,
		Allocations:            allocs,
		CommissionPaymentPICID: r.CommissionPaymentPIC,
	}
}

// permit gates every entry point on Director (import = go-live operation).
func permit(actor permission.Actor) error {
	if !actor.Role.Director {
		return ErrForbidden
	}
	return nil
}
