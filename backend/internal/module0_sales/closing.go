package module0_sales

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// Payment schemes (M0 §6 rule 5). VERBATIM and identical to
// module5_finance.Scheme* / module4_client.Intent* — the same strings are
// stored in transactions.payment_intent_scheme and clients.payment_intent.
const (
	PaymentSchemeLunas      = "[Bayar Penuh (Lunas)]"
	PaymentSchemeSebagian   = "[Bayar Sebagian]"
	PaymentSchemeTermin     = "[Termin]"
	PaymentSchemeDiBelakang = "[Bayar di Belakang]"
)

var paymentSchemeSet = map[string]bool{
	PaymentSchemeLunas: true, PaymentSchemeSebagian: true,
	PaymentSchemeTermin: true, PaymentSchemeDiBelakang: true,
}

// Initial statuses birthed at closing (match M5 verbatim).
const (
	trxStatusMenungguVerifikasi     = "[Menunggu Verifikasi]"
	instStatusBelumJatuhTempo       = "[Belum Jatuh Tempo]"
	serviceStatusAwaitingOnboarding = "[Awaiting Onboarding]"
)

// InstallmentInput is one Payment Schedule row (M0 §6 rule 8 / M5 §4).
type InstallmentInput struct {
	Amount  string    `json:"amount"`
	DueDate time.Time `json:"due_date"`
}

// ClosingInput is the Closing Form payload (M0 §6). The negotiated/approved
// value and services come from the attempt's approved proposal + Qualified Form
// snapshot — never re-typed here.
type ClosingInput struct {
	Parties       ClosingParties     `json:"parties"`
	PaymentScheme string             `json:"payment_scheme"`
	Installments  []InstallmentInput `json:"installments"`
	ManagedSince  string             `json:"managed_since"` // optional YYYY-MM-DD
}

// ClosingResult reports the ids birthed by a successful closing.
type ClosingResult struct {
	ClientID      string `json:"client_id"`
	TransactionID string `json:"transaction_id"`
}

func (in ClosingInput) validateShape() error {
	if err := in.Parties.Validate(); err != nil {
		return err
	}
	if !paymentSchemeSet[in.PaymentScheme] {
		return ErrIncomplete
	}
	switch in.PaymentScheme {
	case PaymentSchemeTermin:
		if len(in.Installments) == 0 {
			return ErrIncomplete
		}
	case PaymentSchemeDiBelakang:
		if len(in.Installments) != 1 {
			return ErrIncomplete
		}
	default: // Lunas / Sebagian carry no schedule
		if len(in.Installments) != 0 {
			return ErrIncomplete
		}
	}
	for _, inst := range in.Installments {
		c, err := money.Parse(inst.Amount)
		if err != nil || c <= 0 || inst.DueDate.IsZero() {
			return ErrIncomplete
		}
	}
	return nil
}

// Close births the Client Record + Transaction + Services + Installments from
// a Negotiation-Approved / Auto-Approved attempt, in ONE transaction. It splits
// achievement across 1..5 salespeople (Σ = 10000 bp), fixes the payment scheme,
// transitions the attempt to Closed-Success, and — via the injected
// WinResolverFunc — fires M1 §6 win resolution for pool competitors.
func (s *Service) Close(ctx context.Context, actor permission.Actor, attemptID string, in ClosingInput) (ClosingResult, error) {
	if err := in.validateShape(); err != nil {
		return ClosingResult{}, err
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return ClosingResult{}, err
	}
	defer tx.Rollback()

	a, err := loadAttempt(ctx, tx, attemptID, true)
	if err != nil {
		return ClosingResult{}, err
	}
	if !canWriteAttempt(actor, a.ownerID) {
		return ClosingResult{}, &blockedError{msgDenied}
	}
	if a.status != StatusNegApproved && a.status != StatusNegAutoApprove {
		// M0 §6 rule 1: only Approved / Auto Approved may close.
		return ClosingResult{}, &blockedError{statemachine.DefaultBlockMessage}
	}

	// Client draft from the Qualified Form.
	qf, err := loadQualifiedForm(ctx, tx, attemptID)
	if err != nil {
		return ClosingResult{}, err
	}
	// Final approved lines = latest proposal version's lines.
	lines, err := loadApprovedLines(ctx, tx, attemptID)
	if err != nil {
		return ClosingResult{}, err
	}
	if len(lines) == 0 {
		return ClosingResult{}, ErrIncomplete
	}

	// Total agreed value = Σ proposed_price (cents-exact).
	var total money.Money
	for _, l := range lines {
		p, err := money.Parse(l.proposedPrice)
		if err != nil {
			return ClosingResult{}, err
		}
		total += p
	}
	// Payment-scheme money rule: scheduled amounts must sum to the total.
	if err := validateScheduleTotal(in, total); err != nil {
		return ClosingResult{}, err
	}

	// Timestamp persist tetap UTC (O20 hanya mengubah bucketing kalender;
	// komponen YYYYMM di-WIB-kan di dalam ident.Next, input UTC tidak masalah).
	now := time.Now().UTC()
	primary := in.Parties.PrimarySalespersonID
	pic := in.Parties.ResolvedPIC()

	// 1) Client Record (CLI-).
	clientID, err := ident.Next(ctx, tx, "CLI", now)
	if err != nil {
		return ClosingResult{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO clients
		   (id, lead_id, winning_attempt_id, nama_pic, toko, kota, link_toko, kategori,
		    gmv_baseline, target_gmv, marketing_budget, origin_campaign_id,
		    sales_pic_id, commission_payment_pic_id, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		clientID, a.leadID, attemptID, qf.namaPIC, qf.toko, qf.kota, qf.linkToko, qf.kategori,
		qf.gmvBaseline, qf.targetGMV, qf.marketingBudget, a.originCampaign,
		primary, pic, actor.EmployeeID); err != nil {
		return ClosingResult{}, err
	}

	// 2) Primary platform snapshot.
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO client_platforms (client_id, platform, store_link, managed_since, created_by)
		 VALUES (?, ?, ?, ?, ?)`,
		clientID, qf.platform, qf.storeLink, nullDate(in.ManagedSince), actor.EmployeeID); err != nil {
		return ClosingResult{}, err
	}

	// 3) Sales allocation (Σ = 100% = 10000 bp, read-only snapshot).
	for _, al := range in.Parties.Allocations {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
			 VALUES (?, ?, ?, ?)`,
			clientID, al.SalespersonID, al.BasisPoints, actor.EmployeeID); err != nil {
			return ClosingResult{}, err
		}
	}

	// 4) Services (SVC- per line, born at [Awaiting Onboarding]). MSL version + name from the
	// pinned Qualified Form snapshot; agreed price + commission from the
	// approved proposal line.
	for _, l := range lines {
		svcID, err := ident.Next(ctx, tx, "SVC", now)
		if err != nil {
			return ClosingResult{}, err
		}
		// M6 §2: the Service inherits the pinned MSL version's "Requires Strategy
		// Plan" flag (read-only) — captured at closing so later catalog edits never
		// change an in-flight Service's execution path.
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO services
			   (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, requires_strategy_plan, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			svcID, clientID, l.masterServiceID, l.versionNo, l.name, l.proposedPrice, l.commissionRule,
			serviceStatusAwaitingOnboarding, boolToTiny(l.requiresStrategyPlan), actor.EmployeeID); err != nil {
			return ClosingResult{}, err
		}
	}

	// 5) Transaction (TRX-) born awaiting Finance verification.
	trxID, err := ident.Next(ctx, tx, "TRX", now)
	if err != nil {
		return ClosingResult{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO transactions
		   (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		trxID, clientID, in.PaymentScheme, total.Decimal(), trxStatusMenungguVerifikasi, actor.EmployeeID); err != nil {
		return ClosingResult{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE clients SET transaction_id = ?, payment_intent = ? WHERE id = ?`,
		trxID, in.PaymentScheme, clientID); err != nil {
		return ClosingResult{}, err
	}

	// 6) Installments (INST-) for scheduled schemes.
	for i, inst := range in.Installments {
		instID, err := ident.Next(ctx, tx, "INST", now)
		if err != nil {
			return ClosingResult{}, err
		}
		amt, _ := money.Parse(inst.Amount) // validated
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO installments
			   (id, transaction_id, installment_no, amount, due_date, status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			instID, trxID, i+1, amt.Decimal(), inst.DueDate.Format("2006-01-02"),
			instStatusBelumJatuhTempo, actor.EmployeeID); err != nil {
			return ClosingResult{}, err
		}
	}

	// 7) Transition attempt to Closed-Success (engine, audited).
	if err := s.transition(ctx, tx, attemptID, StatusClosedSuccess, actor); err != nil {
		return ClosingResult{}, err
	}

	// 8) Win resolution for pool competitors (M1 §6 rule 5), inside this tx.
	if s.Win != nil {
		if err := s.Win(ctx, tx, a.leadID, attemptID, primary, now); err != nil {
			return ClosingResult{}, err
		}
	}

	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: clientID, Actor: actor.EmployeeID,
		Action: "closing", After: map[string]any{
			"transaction_id": trxID, "attempt_id": attemptID,
			"total_agreed_value": total.Decimal(), "payment_scheme": in.PaymentScheme,
		},
	}); err != nil {
		return ClosingResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return ClosingResult{}, err
	}
	return ClosingResult{ClientID: clientID, TransactionID: trxID}, nil
}

// validateScheduleTotal enforces that scheduled installments sum exactly to the
// transaction total for Termin / Bayar di Belakang (M5 §4).
func validateScheduleTotal(in ClosingInput, total money.Money) error {
	switch in.PaymentScheme {
	case PaymentSchemeTermin, PaymentSchemeDiBelakang:
		var sum money.Money
		for _, inst := range in.Installments {
			c, _ := money.Parse(inst.Amount)
			sum += c
		}
		if sum != total {
			return ErrIncomplete
		}
	}
	return nil
}

// ---- reads -----------------------------------------------------------------

type qualifiedFormRow struct {
	namaPIC, toko, kota, linkToko, kategori, platform string
	storeLink                                         any
	gmvBaseline, targetGMV                            string
	marketingBudget                                   any
}

func loadQualifiedForm(ctx context.Context, tx *sql.Tx, attemptID string) (qualifiedFormRow, error) {
	var q qualifiedFormRow
	var store, budget sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT nama_pic, toko, kota, link_toko, kategori, platform, store_link,
		        gmv_baseline, target_gmv, marketing_budget
		   FROM qualified_forms WHERE attempt_id = ?`, attemptID).
		Scan(&q.namaPIC, &q.toko, &q.kota, &q.linkToko, &q.kategori, &q.platform, &store,
			&q.gmvBaseline, &q.targetGMV, &budget)
	if err == sql.ErrNoRows {
		return qualifiedFormRow{}, ErrIncomplete
	}
	if err != nil {
		return qualifiedFormRow{}, err
	}
	q.storeLink = nullOf(store)
	q.marketingBudget = nullOf(budget)
	return q, nil
}

type approvedLine struct {
	masterServiceID, proposedPrice, commissionRule, name string
	versionNo                                            int
	requiresStrategyPlan                                 bool
}

// boolToTiny maps a Go bool to MySQL TINYINT(1).
func boolToTiny(b bool) int {
	if b {
		return 1
	}
	return 0
}

// loadApprovedLines returns the latest proposal version's lines, enriched with
// the pinned MSL version_no + name from the Qualified Form snapshot.
func loadApprovedLines(ctx context.Context, tx *sql.Tx, attemptID string) ([]approvedLine, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT npl.master_service_id, npl.proposed_price, npl.commission_rule,
		        COALESCE(qfs.name, ''), COALESCE(qfs.master_version_no, 0),
		        COALESCE(msv.requires_strategy_plan, 0)
		   FROM negotiation_proposal_lines npl
		   JOIN negotiation_proposals np ON np.id = npl.proposal_id
		   LEFT JOIN qualified_form_services qfs
		          ON qfs.attempt_id = np.attempt_id AND qfs.master_service_id = npl.master_service_id
		   LEFT JOIN master_service_versions msv
		          ON msv.service_id = npl.master_service_id AND msv.version_no = qfs.master_version_no
		  WHERE np.attempt_id = ?
		    AND np.version_no = (SELECT MAX(version_no) FROM negotiation_proposals WHERE attempt_id = ?)
		  ORDER BY npl.id`, attemptID, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []approvedLine
	for rows.Next() {
		var l approvedLine
		var rsp int
		if err := rows.Scan(&l.masterServiceID, &l.proposedPrice, &l.commissionRule, &l.name, &l.versionNo, &rsp); err != nil {
			return nil, err
		}
		l.requiresStrategyPlan = rsp == 1
		out = append(out, l)
	}
	return out, rows.Err()
}

func nullOf(s sql.NullString) any {
	if !s.Valid {
		return nil
	}
	return s.String
}

func nullDate(s string) any {
	if s == "" {
		return nil
	}
	return s
}
