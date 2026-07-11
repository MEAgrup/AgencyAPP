package sales

// closing.go — W1-09 "Closing Form" (M0 §6; docs/backlog/WAVE1 BACKLOG.md).
//
// Closing is the moment Module 4's Client Record and Module 5's Transaction
// are born: it locks the winning attempt's negotiation-approved value and
// services, splits achievement across 1..5 salespeople (allocation basis
// points Σ = 10000, house convention #4 — never a float), fixes the Contract
// Terms and Payment Scheme, and — in ONE transaction — transitions the
// attempt to `Closed-Success`, fires M1 §6 rule 5 win resolution for any
// contested pool competitors, and generates CLI-/TRX-/SVC-/INST- ids.
//
// Import direction (NO cross-import): module0_sales must NOT import
// module1_leads — module1_leads' own W1-03 test (claim_test.go, package
// leads) imports module0_sales to exercise ResolveWin end-to-end with a real
// *sales.Attempts, so a sales→leads production import would form an
// import cycle in the leads test binary. Win resolution is therefore injected
// as a plain callback (WinResolverFunc, no leads types in its signature): the
// wiring layer / test — which imports both modules — binds it to
// leads.Service.ResolveWin with *sales.Attempts as the CompetitionResolver.
// The won lead's Origin Campaign is read by direct SQL against the `leads`
// table (a stable column, migrations/0030) rather than importing the package.
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Byte-exact Payment Scheme values (M0 §6 rule 5, aligned with M4 §5 / M5
// §4).
const (
	PaymentSchemeLunas      = "[Bayar Penuh (Lunas)]"
	PaymentSchemeSebagian   = "[Bayar Sebagian]"
	PaymentSchemeTermin     = "[Termin]"
	PaymentSchemeDiBelakang = "[Bayar di Belakang]"
)

var paymentSchemeSet = map[string]bool{
	PaymentSchemeLunas:      true,
	PaymentSchemeSebagian:   true,
	PaymentSchemeTermin:     true,
	PaymentSchemeDiBelakang: true,
}

// MaxSalespeople is the M0 §6 rule 3 cap: Primary + up to 4 more.
const MaxSalespeople = 5

// AllocationBasisPointsTotal is the required Σ of every SalespersonAllocation
// row on a closing (house convention #4: allocation stored as integer basis
// points, never a float/percent).
const AllocationBasisPointsTotal = 10000

// ErrClientNotFound is returned when reading a Client id that does not exist.
var ErrClientNotFound = errors.New("sales: client not found")

// WinResolverFunc fires M1 §6 rule 5 win resolution INSIDE the closing
// transaction. Its signature is deliberately free of any module1_leads type
// so module0_sales never imports that package (see the file header). The
// wiring layer / test binds it to leads.Service.ResolveWin with the
// *sales.Attempts as the CompetitionResolver, e.g.:
//
//	win := func(ctx context.Context, tx *sql.Tx, leadID, winning, winner string, now time.Time) error {
//	    return leadsSvc.ResolveWin(ctx, tx, attempts, leadID, winning, winner, now)
//	}
//
// It runs after the winning attempt has transitioned to Closed-Success, in
// the same tx, so the close and every competitor auto-close commit together.
type WinResolverFunc func(ctx context.Context, tx *sql.Tx, leadID, winningProspectID, winnerEmployeeID string, now time.Time) error

// Closing is the W1-09 service type. Construct with NewClosing.
type Closing struct {
	attempts *Attempts
	win      WinResolverFunc
}

// NewClosing wires Closing over an existing *Attempts (reusing its engine,
// id generator, audit logger and permission checker — same package, so the
// unexported fields are accessed directly) and a WinResolverFunc (bound to
// leads.Service.ResolveWin by the caller, which imports both modules).
func NewClosing(attempts *Attempts, win WinResolverFunc) *Closing {
	return &Closing{attempts: attempts, win: win}
}

// ---- input --------------------------------------------------------------

// SalespersonAllocation is one row of the Closing Form's Sales Allocation
// (M0 §6 rules 2-4): the Primary Salesperson (the attempt owner) MUST be one
// of these rows.
type SalespersonAllocation struct {
	EmployeeID string
	// BasisPoints is this salesperson's share of the allocation, in basis
	// points (10000 = 100%). The Σ across every row MUST equal exactly
	// AllocationBasisPointsTotal.
	BasisPoints int
	// IsCommissionPaymentPIC marks the Commission & Payment PIC (M0 §6 rule
	// 4): exactly one row must set this when len(Salespeople) > 1. Ignored
	// (the sole salesperson is always the PIC) when closing solo.
	IsCommissionPaymentPIC bool
}

// InstallmentInput is one Payment Schedule row (M0 §6 rule 8 / M5 §4): due
// date + amount. ProposedPrice/EntryID-style decimal literal, never a float.
type InstallmentInput struct {
	Amount  string
	DueDate time.Time
}

// ClosingInput is the W1-09 Closing Form payload (M0 §6 rule 5).
type ClosingInput struct {
	Salespeople             []SalespersonAllocation
	ContractStartDate       time.Time
	ContractDurationMonths  int
	PaymentScheme           string
	// Installments is mandatory (>=1) for PaymentSchemeTermin, exactly one
	// row for PaymentSchemeDiBelakang, and must be empty for
	// PaymentSchemeLunas / PaymentSchemeSebagian (M5 §4).
	Installments []InstallmentInput
}

// validate runs the pure (no-DB) structural validation: list shape,
// allocation Σ/PIC, contract fields, payment scheme membership, and the
// per-scheme installment SHAPE (count/positivity) — everything except the
// termin-sum-vs-transaction-total check, which needs the negotiation's
// approved total value and therefore runs inside the transaction
// (validateInstallmentTotal).
func (in ClosingInput) validate() error {
	if len(in.Salespeople) == 0 || len(in.Salespeople) > MaxSalespeople {
		return validationErr()
	}
	seen := make(map[string]bool, len(in.Salespeople))
	var sumBP, picCount int
	for _, sp := range in.Salespeople {
		if sp.EmployeeID == "" || seen[sp.EmployeeID] {
			return validationErr()
		}
		seen[sp.EmployeeID] = true
		if sp.BasisPoints <= 0 {
			return validationErr()
		}
		sumBP += sp.BasisPoints
		if sp.IsCommissionPaymentPIC {
			picCount++
		}
	}
	if sumBP != AllocationBasisPointsTotal {
		return validationErr()
	}
	if len(in.Salespeople) > 1 && picCount != 1 {
		return validationErr()
	}

	if in.ContractStartDate.IsZero() || in.ContractDurationMonths <= 0 {
		return validationErr()
	}
	if !paymentSchemeSet[in.PaymentScheme] {
		return validationErr()
	}

	switch in.PaymentScheme {
	case PaymentSchemeTermin:
		if len(in.Installments) == 0 {
			return validationErr()
		}
		for _, inst := range in.Installments {
			cents, ok := ParseDecimalCents(inst.Amount)
			if !ok || cents <= 0 || inst.DueDate.IsZero() {
				return validationErr()
			}
		}
	case PaymentSchemeDiBelakang:
		if len(in.Installments) != 1 {
			return validationErr()
		}
		cents, ok := ParseDecimalCents(in.Installments[0].Amount)
		if !ok || cents <= 0 || in.Installments[0].DueDate.IsZero() {
			return validationErr()
		}
	default: // Lunas, Sebagian: no installment rows (M5 §4).
		if len(in.Installments) != 0 {
			return validationErr()
		}
	}
	return nil
}

// validateInstallmentTotal enforces the money-dependent half of the payment
// schedule rules: Termin's schedule must sum to EXACTLY the transaction total
// (else the byte-exact msg.TotalTerminTidakSama, M5 §4); Bayar di Belakang's
// single installment must equal the total exactly too, but the PRD specifies
// no distinct string for that mismatch, so it falls back to the default BI
// message (pinned decision: the Termin sum mismatch is the ONLY specific
// string).
func (in ClosingInput) validateInstallmentTotal(totalValueCents int64) error {
	switch in.PaymentScheme {
	case PaymentSchemeTermin:
		var sum int64
		for _, inst := range in.Installments {
			c, _ := ParseDecimalCents(inst.Amount) // validated in validate()
			sum += c
		}
		if sum != totalValueCents {
			return &ValidationError{Message: msg.TotalTerminTidakSama}
		}
	case PaymentSchemeDiBelakang:
		c, _ := ParseDecimalCents(in.Installments[0].Amount) // validated in validate()
		if c != totalValueCents {
			return validationErr()
		}
	}
	return nil
}

func containsEmployee(sp []SalespersonAllocation, employeeID string) bool {
	for _, s := range sp {
		if s.EmployeeID == employeeID {
			return true
		}
	}
	return false
}

// ---- read structs ---------------------------------------------------------

// SalesAllocationEntry is one row of a Client's read-only Sales Allocation
// snapshot (M4 §7.3).
type SalesAllocationEntry struct {
	EmployeeID             string
	BasisPoints            int
	IsPrimary              bool
	IsCommissionPaymentPIC bool
}

// ClientService is one row of a Client's immutable Service List (M4-OA-5).
type ClientService struct {
	ServiceID         string
	EntryID           int64
	MSLVersionID      int64
	MSLVersion        int
	ServiceName       string
	FinalPrice        string
	CommissionRule    string
	Komisi            *string
	CommissionPending bool
}

// FinalPriceIDR renders the final agreed price (house convention #7).
func (v ClientService) FinalPriceIDR() string { return FormatIDR(v.FinalPrice) }

// KomisiIDR renders the evaluated commission, or Dash while pending (§2.7).
func (v ClientService) KomisiIDR() string {
	if v.Komisi == nil {
		return Dash
	}
	return FormatIDR(*v.Komisi)
}

// InstallmentEntry is one row of the Transaction's Payment Schedule
// (HRIS Module5 §4/§8.4).
type InstallmentEntry struct {
	InstallmentID string
	Position      int
	Amount        string
	DueDate       time.Time
	Status        string
}

// AmountIDR renders the installment amount (house convention #7).
func (v InstallmentEntry) AmountIDR() string { return FormatIDR(v.Amount) }

// Client is the read-side view of a Client Record born at closing (M4 §3),
// its Sales Allocation / Service List, and the sibling Transaction / Payment
// Schedule born alongside it (M0 §6 rule 7-8 / M5 §2-4).
type Client struct {
	ClientID              string
	NamaPIC               string
	NamaToko              string
	LinkToko              string
	KategoriBisnis        string
	Kota                  string
	PlatformList          []string
	GMVSaatIni            string
	TargetGMV             string
	MarketingBudget       *string
	TotalSales            string
	OriginCampaign        *string
	WinningProspectID     string
	LeadID                string
	SalesPIC              string
	CommissionPaymentPIC  string
	PaymentIntentScheme   string
	ClosedAt              time.Time
	ClosedBy              string
	Allocations           []SalesAllocationEntry
	Services              []ClientService

	TransactionID            string
	TransactionTotalValue    string
	TransactionPaymentStatus string
	ContractStartDate        time.Time
	ContractDurationMonths   int
	Installments             []InstallmentEntry
}

// GMVSaatIniIDR renders the frozen GMV baseline.
func (c *Client) GMVSaatIniIDR() string { return FormatIDR(c.GMVSaatIni) }

// TargetGMVIDR renders the Target GMV.
func (c *Client) TargetGMVIDR() string { return FormatIDR(c.TargetGMV) }

// MarketingBudgetIDR renders the optional Marketing Budget, or Dash (§2.7).
func (c *Client) MarketingBudgetIDR() string {
	if c.MarketingBudget == nil {
		return Dash
	}
	return FormatIDR(*c.MarketingBudget)
}

// TotalSalesIDR renders the auto-updated current sales figure.
func (c *Client) TotalSalesIDR() string { return FormatIDR(c.TotalSales) }

// TransactionTotalValueIDR renders the transaction's agreed total.
func (c *Client) TransactionTotalValueIDR() string { return FormatIDR(c.TransactionTotalValue) }

// ---- write: SubmitClosing ---------------------------------------------------

// SubmitClosing executes the M0 §6 Closing flow for the winning attempt
// prospectID: validates every closing rule server-side, then — in ONE
// engine-managed transaction — transitions the attempt to `Closed-Success`,
// fires M1 §6 rule 5 win resolution for any contested pool competitors, and
// generates the Client/Transaction/Service(s)/Installment(s) rows. Any
// failure (permission, validation, or a blocked transition) leaves ZERO side
// effects: no status change, no ids consumed, no rows written.
func (c *Closing) SubmitClosing(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, in ClosingInput) (*Client, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}
	roles := toStatemachineRoles(actor.Roles)

	var client *Client
	err := c.attempts.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttemptForUpdate(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := c.attempts.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}

		// M0 §6 rule 1: only Negotiation - Approved / Auto Approved may
		// close. Checked explicitly (mirroring negotiation.go's
		// decideApprove pattern) so a non-approved from-state is refused
		// BEFORE any negotiation/allocation validation runs, with the
		// engine's own blocked-transition shape and message.
		if att.Status != statemachine.ProspectNegApproved && att.Status != statemachine.ProspectNegAutoApproved {
			return &statemachine.BlockedError{
				Entity:  statemachine.EntityProspect,
				From:    att.Status,
				To:      statemachine.ProspectClosedSuccess,
				Message: msg.TransisiTidakDiizinkan,
				Reason:  "not_allowed",
			}
		}

		neg, err := loadNegotiation(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		appr := neg.Approved()
		if appr == nil {
			// Defensive: att.Status being Approved/Auto Approved should
			// always imply an approved_version is pinned (see
			// decideApprove / SubmitNoNegotiation). No PRD string covers
			// this state, so it falls back to the default mandatory-field
			// message.
			return validationErr()
		}

		// M0 §6 rule 2: Primary Salesperson = the attempt owner, mandatory
		// and present in the allocation list.
		if !containsEmployee(in.Salespeople, att.OwnerEmployeeID) {
			return validationErr()
		}

		totalValueCents, ok := ParseDecimalCents(appr.TotalValue)
		if !ok {
			return fmt.Errorf("sales: approved negotiation total %q unparseable for %s", appr.TotalValue, prospectID)
		}
		if err := in.validateInstallmentTotal(totalValueCents); err != nil {
			return err
		}

		now := time.Now().UTC()

		// Transition first (pinned decision #8), THEN resolve the pool
		// competition win in the same transaction.
		if err := c.attempts.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectClosedSuccess,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
		}); err != nil {
			return err
		}
		if err := c.win(ctx, tx, att.LeadID, prospectID, att.OwnerEmployeeID, now); err != nil {
			return err
		}

		qf, err := loadQualifiedForm(ctx, tx, prospectID)
		if err != nil {
			return err
		}

		// Origin Campaign is inherited from the won lead (M4 §3): read the
		// column directly (no module1_leads import — see the file header).
		var originCampaign *string
		var oc sql.NullString
		switch err := tx.QueryRowContext(ctx, `SELECT origin_campaign FROM leads WHERE lead_id = ?`, att.LeadID).Scan(&oc); err {
		case nil:
			if oc.Valid && oc.String != "" {
				s := oc.String
				originCampaign = &s
			}
		case sql.ErrNoRows:
			return fmt.Errorf("sales: won lead %s not found", att.LeadID)
		default:
			return fmt.Errorf("sales: load won lead %s: %w", att.LeadID, err)
		}

		cliID, err := c.attempts.idgen.Next(ctx, tx, ids.PrefixClient, now)
		if err != nil {
			return fmt.Errorf("sales: generate client id: %w", err)
		}
		trxID, err := c.attempts.idgen.Next(ctx, tx, ids.PrefixTransaction, now)
		if err != nil {
			return fmt.Errorf("sales: generate transaction id: %w", err)
		}

		primaryID := att.OwnerEmployeeID
		commissionPIC := primaryID
		if len(in.Salespeople) > 1 {
			for _, sp := range in.Salespeople {
				if sp.IsCommissionPaymentPIC {
					commissionPIC = sp.EmployeeID
					break
				}
			}
		}

		if err := insertClient(ctx, tx, cliID, qf, originCampaign, prospectID, att.LeadID, primaryID, commissionPIC, in.PaymentScheme, now, actor.EmployeeID); err != nil {
			return err
		}
		for _, sp := range in.Salespeople {
			// Store the RESOLVED PIC flag (not the raw input) so a solo
			// closing's auto-PIC (M0 §6 rule 4) is reflected on the row even
			// though the caller never had to set IsCommissionPaymentPIC.
			isPIC := sp.EmployeeID == commissionPIC
			if err := insertSalesAllocation(ctx, tx, cliID, sp, sp.EmployeeID == primaryID, isPIC, now); err != nil {
				return err
			}
		}

		if _, err := buildClientServices(ctx, tx, c.attempts.idgen, now, cliID, appr.Services); err != nil {
			return err
		}

		if err := insertTransaction(ctx, tx, trxID, cliID, appr.TotalValue, in.PaymentScheme, in.ContractStartDate, in.ContractDurationMonths, now, actor.EmployeeID); err != nil {
			return err
		}
		if _, err := buildInstallments(ctx, tx, c.attempts.idgen, now, trxID, in.Installments); err != nil {
			return err
		}

		if err := c.auditClosing(ctx, tx, actor, cliID, trxID, prospectID, primaryID, commissionPIC, in, appr, now); err != nil {
			return err
		}

		client, err = loadClient(ctx, tx, cliID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return client, nil
}

func (c *Closing) auditClosing(ctx context.Context, tx *sql.Tx, actor authz.Identity, cliID, trxID, prospectID, primaryID, commissionPIC string, in ClosingInput, appr *NegotiationVersion, now time.Time) error {
	clientAfter, _ := json.Marshal(map[string]any{
		"client_id":              cliID,
		"prospect_id":            prospectID,
		"sales_pic":              primaryID,
		"commission_payment_pic": commissionPIC,
		"salespeople":            in.Salespeople,
		"payment_intent_scheme":  in.PaymentScheme,
	})
	if _, err := c.attempts.auditLg.Append(ctx, tx, audit.Entry{
		EntityType: "client",
		EntityID:   cliID,
		Actor:      actor.EmployeeID,
		Action:     "client_created",
		After:      clientAfter,
		At:         now,
	}); err != nil {
		return fmt.Errorf("sales: audit client_created: %w", err)
	}

	trxAfter, _ := json.Marshal(map[string]any{
		"transaction_id":        trxID,
		"client_id":             cliID,
		"total_value":           appr.TotalValue,
		"payment_intent_scheme": in.PaymentScheme,
		"installments":          in.Installments,
	})
	if _, err := c.attempts.auditLg.Append(ctx, tx, audit.Entry{
		EntityType: "transaction",
		EntityID:   trxID,
		Actor:      actor.EmployeeID,
		Action:     "transaction_created",
		After:      trxAfter,
		At:         now,
	}); err != nil {
		return fmt.Errorf("sales: audit transaction_created: %w", err)
	}
	return nil
}

func insertClient(ctx context.Context, tx *sql.Tx, clientID string, qf *QualifiedForm, originCampaign *string, prospectID, leadID, primaryID, commissionPIC, paymentScheme string, now time.Time, actorID string) error {
	platforms, err := json.Marshal(qf.PlatformList)
	if err != nil {
		return fmt.Errorf("sales: marshal client platform list: %w", err)
	}
	var marketingBudget, originCampaignVal any
	if qf.MarketingBudget != nil {
		marketingBudget = *qf.MarketingBudget
	}
	if originCampaign != nil {
		originCampaignVal = *originCampaign
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO clients
			(client_id, nama_pic, nama_toko, link_toko, kategori_bisnis, kota, platform_list,
			 gmv_saat_ini, target_gmv, marketing_budget, total_sales, origin_campaign,
			 winning_prospect_id, lead_id, sales_pic, commission_payment_pic, payment_intent_scheme,
			 closed_at, closed_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, ?, ?, ?)`,
		clientID, qf.NamaPIC, qf.NamaToko, qf.LinkToko, qf.KategoriBisnis, qf.Kota, string(platforms),
		qf.GMVSaatIni, qf.TargetGMV, marketingBudget, originCampaignVal,
		prospectID, leadID, primaryID, commissionPIC, paymentScheme,
		now, actorID,
	); err != nil {
		return fmt.Errorf("sales: insert client: %w", err)
	}
	return nil
}

func insertSalesAllocation(ctx context.Context, tx *sql.Tx, clientID string, sp SalespersonAllocation, isPrimary, isCommissionPaymentPIC bool, now time.Time) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO sales_allocations (client_id, employee_id, basis_points, is_primary, is_commission_payment_pic, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		clientID, sp.EmployeeID, sp.BasisPoints, isPrimary, isCommissionPaymentPIC, now,
	); err != nil {
		return fmt.Errorf("sales: insert sales allocation for %s: %w", sp.EmployeeID, err)
	}
	return nil
}

func buildClientServices(ctx context.Context, tx *sql.Tx, idgen ids.Generator, now time.Time, clientID string, services []NegotiationServiceView) ([]ClientService, error) {
	out := make([]ClientService, 0, len(services))
	for i, sv := range services {
		svcID, err := idgen.Next(ctx, tx, ids.PrefixService, now)
		if err != nil {
			return nil, fmt.Errorf("sales: generate service id: %w", err)
		}
		var komisi any
		if sv.Komisi != nil {
			komisi = *sv.Komisi
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO client_services
				(service_id, client_id, position, entry_id, msl_version_id, msl_version,
				 service_name, final_price, commission_rule, komisi, commission_pending, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			svcID, clientID, i+1, sv.EntryID, sv.MSLVersionID, sv.MSLVersion,
			sv.Name, sv.ProposedPrice, sv.CommissionRule, komisi, sv.CommissionPending, now,
		); err != nil {
			return nil, fmt.Errorf("sales: insert client service %d: %w", sv.EntryID, err)
		}
		out = append(out, ClientService{
			ServiceID: svcID, EntryID: sv.EntryID, MSLVersionID: sv.MSLVersionID, MSLVersion: sv.MSLVersion,
			ServiceName: sv.Name, FinalPrice: sv.ProposedPrice, CommissionRule: sv.CommissionRule,
			Komisi: sv.Komisi, CommissionPending: sv.CommissionPending,
		})
	}
	return out, nil
}

func insertTransaction(ctx context.Context, tx *sql.Tx, trxID, clientID, totalValue, paymentScheme string, contractStart time.Time, contractMonths int, now time.Time, actorID string) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO transactions
			(transaction_id, client_id, total_value, payment_intent_scheme, payment_status, amount_verified,
			 contract_start_date, contract_duration_months, last_status_at, created_at, created_by)
		 VALUES (?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?)`,
		trxID, clientID, totalValue, paymentScheme, string(statemachine.TxnMenungguVerifikasi),
		contractStart, contractMonths, now, now, actorID,
	); err != nil {
		return fmt.Errorf("sales: insert transaction: %w", err)
	}
	return nil
}

func buildInstallments(ctx context.Context, tx *sql.Tx, idgen ids.Generator, now time.Time, trxID string, in []InstallmentInput) ([]InstallmentEntry, error) {
	out := make([]InstallmentEntry, 0, len(in))
	for i, inst := range in {
		instID, err := idgen.Next(ctx, tx, ids.PrefixInstallment, now)
		if err != nil {
			return nil, fmt.Errorf("sales: generate installment id: %w", err)
		}
		amountCents, _ := ParseDecimalCents(inst.Amount) // validated upstream
		amount := CentsToDecimal(amountCents)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO installments (installment_id, transaction_id, position, amount, due_date, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			instID, trxID, i+1, amount, inst.DueDate, string(statemachine.InstBelumJatuhTempo), now,
		); err != nil {
			return nil, fmt.Errorf("sales: insert installment %d: %w", i+1, err)
		}
		out = append(out, InstallmentEntry{
			InstallmentID: instID, Position: i + 1, Amount: amount, DueDate: inst.DueDate,
			Status: string(statemachine.InstBelumJatuhTempo),
		})
	}
	return out, nil
}

// ---- read: GetClient --------------------------------------------------------

// GetClient reads a Client Record — identity/baseline, Sales Allocation,
// Service List, and the sibling Transaction/Payment Schedule.
//
// Permission (M4 §6): Staff sees only clients where they are the Sales PIC or
// listed in the Sales Allocation (even when not Primary); Head/SPV Sales see
// every client division-wide; OD read-only everywhere; Director full.
func (c *Closing) GetClient(ctx context.Context, q db.Queryer, actor authz.Identity, clientID string) (*Client, error) {
	if !actor.Authenticated() {
		return nil, readDenied(actor)
	}
	cl, err := loadClient(ctx, q, clientID)
	if err != nil {
		return nil, err
	}
	if err := requireClientRead(actor, cl); err != nil {
		return nil, err
	}
	return cl, nil
}

func requireClientRead(actor authz.Identity, cl *Client) error {
	if actor.Has(authz.RoleDirector) || actor.Has(authz.RoleOD) {
		return nil
	}
	if actor.Has(authz.RoleLeadSPV) && actor.Divisi == DivisiSales {
		return nil
	}
	if actor.Has(authz.RoleStaff) {
		if actor.EmployeeID == cl.SalesPIC {
			return nil
		}
		for _, a := range cl.Allocations {
			if a.EmployeeID == actor.EmployeeID {
				return nil
			}
		}
	}
	return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "no role grants read access to this client"}
}

func loadClient(ctx context.Context, q db.Queryer, clientID string) (*Client, error) {
	var (
		cl              Client
		platformsRaw    string
		marketingBudget sql.NullString
		originCampaign  sql.NullString
	)
	err := q.QueryRowContext(ctx,
		`SELECT client_id, nama_pic, nama_toko, link_toko, kategori_bisnis, kota, platform_list,
		        gmv_saat_ini, target_gmv, marketing_budget, total_sales, origin_campaign,
		        winning_prospect_id, lead_id, sales_pic, commission_payment_pic, payment_intent_scheme,
		        closed_at, closed_by
		 FROM clients WHERE client_id = ?`, clientID,
	).Scan(&cl.ClientID, &cl.NamaPIC, &cl.NamaToko, &cl.LinkToko, &cl.KategoriBisnis, &cl.Kota, &platformsRaw,
		&cl.GMVSaatIni, &cl.TargetGMV, &marketingBudget, &cl.TotalSales, &originCampaign,
		&cl.WinningProspectID, &cl.LeadID, &cl.SalesPIC, &cl.CommissionPaymentPIC, &cl.PaymentIntentScheme,
		&cl.ClosedAt, &cl.ClosedBy)
	if err == sql.ErrNoRows {
		return nil, ErrClientNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("sales: load client %s: %w", clientID, err)
	}
	if err := json.Unmarshal([]byte(platformsRaw), &cl.PlatformList); err != nil {
		return nil, fmt.Errorf("sales: decode client platform list for %s: %w", clientID, err)
	}
	if marketingBudget.Valid {
		v := marketingBudget.String
		cl.MarketingBudget = &v
	}
	if originCampaign.Valid {
		v := originCampaign.String
		cl.OriginCampaign = &v
	}

	rows, err := q.QueryContext(ctx,
		`SELECT employee_id, basis_points, is_primary, is_commission_payment_pic
		 FROM sales_allocations WHERE client_id = ? ORDER BY id`, clientID)
	if err != nil {
		return nil, fmt.Errorf("sales: load sales allocations %s: %w", clientID, err)
	}
	defer rows.Close()
	for rows.Next() {
		var a SalesAllocationEntry
		var bp int
		if err := rows.Scan(&a.EmployeeID, &bp, &a.IsPrimary, &a.IsCommissionPaymentPIC); err != nil {
			return nil, fmt.Errorf("sales: scan sales allocation: %w", err)
		}
		a.BasisPoints = bp
		cl.Allocations = append(cl.Allocations, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	svcRows, err := q.QueryContext(ctx,
		`SELECT service_id, entry_id, msl_version_id, msl_version, service_name,
		        final_price, commission_rule, komisi, commission_pending
		 FROM client_services WHERE client_id = ? ORDER BY position`, clientID)
	if err != nil {
		return nil, fmt.Errorf("sales: load client services %s: %w", clientID, err)
	}
	defer svcRows.Close()
	for svcRows.Next() {
		var sv ClientService
		var komisi sql.NullString
		if err := svcRows.Scan(&sv.ServiceID, &sv.EntryID, &sv.MSLVersionID, &sv.MSLVersion, &sv.ServiceName,
			&sv.FinalPrice, &sv.CommissionRule, &komisi, &sv.CommissionPending); err != nil {
			return nil, fmt.Errorf("sales: scan client service: %w", err)
		}
		if komisi.Valid {
			v := komisi.String
			sv.Komisi = &v
		}
		cl.Services = append(cl.Services, sv)
	}
	if err := svcRows.Err(); err != nil {
		return nil, err
	}

	err = q.QueryRowContext(ctx,
		`SELECT transaction_id, total_value, payment_status, contract_start_date, contract_duration_months
		 FROM transactions WHERE client_id = ?`, clientID,
	).Scan(&cl.TransactionID, &cl.TransactionTotalValue, &cl.TransactionPaymentStatus,
		&cl.ContractStartDate, &cl.ContractDurationMonths)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("sales: load transaction for client %s: %w", clientID, err)
	}
	if cl.TransactionID != "" {
		instRows, err := q.QueryContext(ctx,
			`SELECT installment_id, position, amount, due_date, status
			 FROM installments WHERE transaction_id = ? ORDER BY position`, cl.TransactionID)
		if err != nil {
			return nil, fmt.Errorf("sales: load installments for %s: %w", cl.TransactionID, err)
		}
		defer instRows.Close()
		for instRows.Next() {
			var inst InstallmentEntry
			if err := instRows.Scan(&inst.InstallmentID, &inst.Position, &inst.Amount, &inst.DueDate, &inst.Status); err != nil {
				return nil, fmt.Errorf("sales: scan installment: %w", err)
			}
			cl.Installments = append(cl.Installments, inst)
		}
		if err := instRows.Err(); err != nil {
			return nil, err
		}
	}

	return &cl, nil
}
