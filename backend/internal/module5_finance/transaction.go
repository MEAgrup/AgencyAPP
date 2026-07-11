package module5_finance

// transaction.go is the Module 5 persistence surface built ON TOP of the frozen
// money math in rollup.go (W1-14). It loads the Transaction aggregate, applies
// M5 visibility, and owns the two intent-time write flows that do NOT verify
// money: CreateSchedule (Termin / Bayar di Belakang installment schedule) and
// ChangeScheme (M5 §4 Rule 5 / M5-OA-6). Verification (W1-15) and the routing
// gate (W1-16) live in sibling files.
//
// House rules honoured here:
//   - status columns move only through the state-machine engine,
//   - INST- IDs come only from ident.Next,
//   - every write appends an immutable audit row; nothing is deleted.

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CDPS divisions relevant to Module 5 authority (mirrors module4_client).
const (
	FinanceDivision = "Finance"
	SalesDivision   = "Sales"
	AccountDivision = "Account"
)

// Payment intent schemes — verbatim from M4 §5 Rule 2 (the same strings stored
// in clients.payment_intent and transactions.payment_intent_scheme). Never
// rename (CLAUDE.md: never rename BI labels).
const (
	SchemeLunas           = "[Bayar Penuh (Lunas)]"
	SchemeBayarSebagian   = "[Bayar Sebagian]"
	SchemeTermin          = "[Termin]"
	SchemeBayarDiBelakang = "[Bayar di Belakang]"
)

// Bahasa Indonesia messages.
//
// PRD-verbatim (do not alter): MsgContractRequired (M5 §7 Rule 2), plus
// OverVerifiedMessage / TerminMismatchMessage (rollup.go) and MsgIncomplete
// (the house default).
//
// Engineering-enforcement strings (the PRD states the rule but quotes no
// verbatim string; introduced under the precedent set for W1-09 in
// docs/DECISIONS.md, and logged there for M5): MsgScheduleExists,
// MsgSchemeNoSchedule, MsgInstallmentNotInTrx, MsgInstallmentAmount,
// MsgDirectOnScheduled.
const (
	MsgIncomplete          = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"
	MsgContractRequired    = "[kontrak belum diupload, lengkapi sebelum verifikasi penuh]"
	MsgScheduleExists      = "[jadwal pembayaran sudah dibuat untuk transaksi ini]"
	MsgSchemeNoSchedule    = "[skema pembayaran ini tidak menggunakan jadwal termin]"
	MsgInstallmentNotInTrx = "[termin tidak ditemukan pada transaksi ini]"
	MsgInstallmentAmount   = "[jumlah tidak sesuai dengan nilai termin]"
	MsgDirectOnScheduled   = "[transaksi memiliki jadwal termin, verifikasi per termin]"
)

// Sentinel errors surfaced to the HTTP layer.
var (
	// ErrNotFound: the transaction does not exist OR is invisible to the actor
	// (M5 §5 Rule 2 — pre-verification records are invisible to Account).
	ErrNotFound = errors.New("transaction not found")
	// ErrForbidden: the actor's role has no access to the requested action.
	ErrForbidden = errors.New(statemachine.RoleDeniedMessage)
	// ErrIncomplete: a mandatory field is missing / the request is malformed.
	ErrIncomplete = errors.New(MsgIncomplete)
	// ErrContractRequired: the [Lunas] gate (M5 §7 Rule 2) — contract missing.
	ErrContractRequired = errors.New(MsgContractRequired)
	// ErrScheduleExists: a schedule (or a verification) already exists, so a new
	// schedule cannot be created (CreateSchedule idempotency guard).
	ErrScheduleExists = errors.New(MsgScheduleExists)
	// ErrSchemeNoSchedule: the transaction's scheme is not Termin / Bayar di
	// Belakang, so it has no installment schedule to create.
	ErrSchemeNoSchedule = errors.New(MsgSchemeNoSchedule)
	// ErrInstallmentNotInTrx: the installment does not belong to the transaction.
	ErrInstallmentNotInTrx = errors.New(MsgInstallmentNotInTrx)
	// ErrInstallmentAmount: the verified amount != the installment amount (per-
	// installment partials are not supported; verify each installment in full).
	ErrInstallmentAmount = errors.New(MsgInstallmentAmount)
	// ErrDirectOnScheduled: a direct (no-installment) verification was attempted
	// on a transaction that has an installment schedule.
	ErrDirectOnScheduled = errors.New(MsgDirectOnScheduled)
)

// Service is the Module 5 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
}

// InstallmentRow is one INST- row as persisted (money + verification detail).
type InstallmentRow struct {
	ID             string      `json:"id"`
	InstallmentNo  int         `json:"installment_no"`
	Amount         money.Money `json:"-"`
	DueDate        *time.Time  `json:"due_date,omitempty"`
	Status         string      `json:"status"`
	JatuhTempo     bool        `json:"jatuh_tempo"`
	VerifiedDate   *time.Time  `json:"verified_date,omitempty"`
	VerifiedBy     string      `json:"verified_by,omitempty"`
	ProofOfPayment string      `json:"proof_of_payment,omitempty"`
}

// TransactionRecord is the full TRX- aggregate for the API and for tests. The
// money fields are recomputed from installments + the payment_verifications log
// via the frozen rollup math (CLAUDE.md #4).
type TransactionRecord struct {
	ID                  string
	ClientID            string
	Scheme              string
	Total               money.Money
	Status              string
	Bermasalah          bool
	ContractAttachment  string
	ReleasedToAccountAt *time.Time
	CreatedAt           time.Time
	Installments        []InstallmentRow

	// Recomputed (read-only) aggregates.
	AmountVerified    money.Money
	AmountOutstanding money.Money
}

// queryRower is satisfied by *sql.DB and *sql.Tx.
type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

const selectTransaction = `
SELECT t.id, t.client_id, t.payment_intent_scheme, t.total_agreed_value, t.payment_status,
       t.bermasalah, t.contract_attachment, t.released_to_account_at, t.created_at
  FROM transactions t`

// LoadTransaction returns one TRX aggregate subject to M5 visibility. A
// transaction the actor cannot see is reported as ErrNotFound; a role with no
// Module 5 access at all gets ErrForbidden.
func (s *Service) LoadTransaction(ctx context.Context, actor permission.Actor, id string) (TransactionRecord, error) {
	clause, args, ok := trxVisibility(actor)
	if !ok {
		return TransactionRecord{}, ErrForbidden
	}
	q := selectTransaction + " JOIN clients c ON c.id = t.client_id WHERE t.id = ? AND (" + clause + ")"
	row := s.DB.QueryRowContext(ctx, q, append([]any{id}, args...)...)
	rec, err := scanTransaction(row)
	if errors.Is(err, sql.ErrNoRows) {
		return TransactionRecord{}, ErrNotFound
	}
	if err != nil {
		return TransactionRecord{}, err
	}
	if err := s.hydrate(ctx, s.DB, &rec); err != nil {
		return TransactionRecord{}, err
	}
	return rec, nil
}

// Queue lists transactions still awaiting verification ([Menunggu Verifikasi]).
// Finance (any level), OD and Director only (M5 §8.1 — the finance queue).
func (s *Service) Queue(ctx context.Context, actor permission.Actor) ([]TransactionRecord, error) {
	if !(actor.Role.Director || actor.Role.OD || actor.Role.Division == FinanceDivision) {
		return nil, ErrForbidden
	}
	q := selectTransaction + " WHERE t.payment_status = ? ORDER BY t.id"
	rows, err := s.DB.QueryContext(ctx, q, TrxMenungguVerifikasi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TransactionRecord{}
	for rows.Next() {
		rec, err := scanTransaction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if err := s.hydrate(ctx, s.DB, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// trxVisibility builds the WHERE predicate (on aliases t = transactions,
// c = clients) for the transactions a role may see (PERMISSIONS.md M5, M5 §5).
//
//	OD / Director        -> all.
//	Finance (staff/lead) -> all (they own the queue).
//	Sales Lead           -> all sales clients.
//	Sales Staff          -> own client (sales_pic_id) OR a Sales-Allocation member.
//	Account (staff/lead) -> only RELEASED transactions (pre-verification invisible).
//	other divisions      -> no access.
func trxVisibility(actor permission.Actor) (clause string, args []any, ok bool) {
	if actor.Role.Director || actor.Role.OD {
		return "1=1", nil, true
	}
	switch actor.Role.Division {
	case FinanceDivision:
		return "1=1", nil, true
	case SalesDivision:
		if actor.Role.Level == permission.LevelLead {
			return "1=1", nil, true
		}
		return "(c.sales_pic_id = ? OR EXISTS (" +
				"SELECT 1 FROM client_sales_allocations a WHERE a.client_id = c.id AND a.salesperson_id = ?))",
			[]any{actor.EmployeeID, actor.EmployeeID}, true
	case AccountDivision:
		// Account reads Payment Status only, and only once released (M5 §5 Rule 2).
		return "t.released_to_account_at IS NOT NULL", nil, true
	default:
		return "", nil, false
	}
}

func scanTransaction(r rowScanner) (TransactionRecord, error) {
	var rec TransactionRecord
	var total string
	var bermasalah int
	var contract sql.NullString
	var released sql.NullTime
	if err := r.Scan(
		&rec.ID, &rec.ClientID, &rec.Scheme, &total, &rec.Status,
		&bermasalah, &contract, &released, &rec.CreatedAt,
	); err != nil {
		return TransactionRecord{}, err
	}
	m, err := money.Parse(total)
	if err != nil {
		return TransactionRecord{}, err
	}
	rec.Total = m
	rec.Bermasalah = bermasalah != 0
	rec.ContractAttachment = contract.String
	if released.Valid {
		rec.ReleasedToAccountAt = &released.Time
	}
	return rec, nil
}

// rowScanner is satisfied by *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// hydrate loads the installment rows and the direct-verified total, then folds
// them through the frozen rollup math into the recomputed money aggregates.
func (s *Service) hydrate(ctx context.Context, q queryRower, rec *TransactionRecord) error {
	insts, err := loadInstallments(ctx, q, rec.ID)
	if err != nil {
		return err
	}
	rec.Installments = insts

	direct, err := directVerifiedTotal(ctx, q, rec.ID)
	if err != nil {
		return err
	}

	agg := aggregate(rec.Total, insts, direct)
	rec.AmountVerified = agg.AmountVerified()
	rec.AmountOutstanding = agg.AmountOutstanding()
	return nil
}

// aggregate folds persisted rows into the frozen rollup Transaction type.
func aggregate(total money.Money, insts []InstallmentRow, direct money.Money) Transaction {
	agg := Transaction{Total: total, DirectVerified: direct}
	for _, r := range insts {
		agg.Installments = append(agg.Installments, Installment{ID: r.ID, Amount: r.Amount, Status: r.Status})
	}
	return agg
}

// directVerifiedTotal = Σ payment_verifications with NULL installment_id (the
// single Lunas payment or the upfront Bayar Sebagian partial). Recompute-from-log.
func directVerifiedTotal(ctx context.Context, q queryRower, trxID string) (money.Money, error) {
	var sum money.Money
	rows, err := q.QueryContext(ctx,
		`SELECT amount FROM payment_verifications WHERE transaction_id = ? AND installment_id IS NULL`, trxID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			return 0, err
		}
		m, err := money.Parse(a)
		if err != nil {
			return 0, err
		}
		sum += m
	}
	return sum, rows.Err()
}

func loadInstallments(ctx context.Context, q queryRower, trxID string) ([]InstallmentRow, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, installment_no, amount, due_date, status, jatuh_tempo, verified_date, verified_by, proof_of_payment
		   FROM installments WHERE transaction_id = ? ORDER BY installment_no`, trxID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InstallmentRow{}
	for rows.Next() {
		var r InstallmentRow
		var amt string
		var due, verifiedDate sql.NullTime
		var jatuhTempo int
		var verifiedBy, proof sql.NullString
		if err := rows.Scan(&r.ID, &r.InstallmentNo, &amt, &due, &r.Status, &jatuhTempo, &verifiedDate, &verifiedBy, &proof); err != nil {
			return nil, err
		}
		m, err := money.Parse(amt)
		if err != nil {
			return nil, err
		}
		r.Amount = m
		r.JatuhTempo = jatuhTempo != 0
		if due.Valid {
			r.DueDate = &due.Time
		}
		if verifiedDate.Valid {
			r.VerifiedDate = &verifiedDate.Time
		}
		r.VerifiedBy = verifiedBy.String
		r.ProofOfPayment = proof.String
		out = append(out, r)
	}
	return out, rows.Err()
}

// ScheduleItem is one requested installment (amount + due date).
type ScheduleItem struct {
	Amount  money.Money
	DueDate time.Time
}

// CreateSchedule builds the installment schedule for a Termin / Bayar di Belakang
// transaction (M5 §4). It is idempotent-guarded: it refuses to run if the
// transaction already has installments or any verification (ErrScheduleExists).
//
// Authority (M5 §4 Flow 1 — "Sales/Finance at intent time"): the client's Sales
// PIC (or an allocation member), Sales Lead, Finance, or Director.
//
// Validation:
//   - Termin: amounts must sum EXACTLY to the total (ValidateTerminSchedule).
//   - Bayar di Belakang: exactly one installment, amount = total (M5 §4 Rule 4).
//   - every item needs a positive amount and a due date (mandatory for these
//     schemes, M5 §8.4).
//
// Each INST- row is minted via ident.Next and INSERTed with the machine's
// initial status [Belum Jatuh Tempo] (initial-state insert is allowed; later
// moves go through the engine). One audit row per transaction summarises the set.
func (s *Service) CreateSchedule(ctx context.Context, actor permission.Actor, transactionID string, items []ScheduleItem) ([]InstallmentRow, error) {
	if len(items) == 0 {
		return nil, ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Lock the TRX row; read scheme + total + owning client.
	var scheme, total, clientID, salesPIC string
	err = tx.QueryRowContext(ctx,
		`SELECT t.payment_intent_scheme, t.total_agreed_value, t.client_id, c.sales_pic_id
		   FROM transactions t JOIN clients c ON c.id = t.client_id
		  WHERE t.id = ? FOR UPDATE`, transactionID).Scan(&scheme, &total, &clientID, &salesPIC)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	member, err := isAllocationMember(ctx, tx, clientID, actor.EmployeeID)
	if err != nil {
		return nil, err
	}
	if !canManageIntent(actor, salesPIC, member) {
		return nil, ErrForbidden
	}

	if scheme != SchemeTermin && scheme != SchemeBayarDiBelakang {
		return nil, ErrSchemeNoSchedule
	}
	if scheme == SchemeBayarDiBelakang && len(items) != 1 {
		return nil, ErrIncomplete
	}

	// Idempotency guard: no existing installments AND no existing verifications.
	var instCount, verCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM installments WHERE transaction_id = ?`, transactionID).Scan(&instCount); err != nil {
		return nil, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM payment_verifications WHERE transaction_id = ?`, transactionID).Scan(&verCount); err != nil {
		return nil, err
	}
	if instCount > 0 || verCount > 0 {
		return nil, ErrScheduleExists
	}

	totalMoney, err := money.Parse(total)
	if err != nil {
		return nil, err
	}

	// Build the rollup-shaped slice for the frozen sum validation; every item
	// needs a due date for these schemes.
	valInsts := make([]Installment, len(items))
	for i, it := range items {
		if it.DueDate.IsZero() {
			return nil, ErrIncomplete
		}
		valInsts[i] = Installment{Amount: it.Amount}
	}
	if err := ValidateTerminSchedule(totalMoney, valInsts); err != nil {
		return nil, err // ErrTerminMismatch / ErrEmptySchedule (PRD-verbatim messages)
	}

	created := make([]InstallmentRow, 0, len(items))
	for i, it := range items {
		id, err := ident.Next(ctx, tx, "INST", time.Now())
		if err != nil {
			return nil, err
		}
		no := i + 1
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, transactionID, no, it.Amount.Decimal(), it.DueDate.Format("2006-01-02"), InstBelumJatuhTempo, actor.EmployeeID); err != nil {
			return nil, err
		}
		due := it.DueDate
		created = append(created, InstallmentRow{
			ID: id, InstallmentNo: no, Amount: it.Amount, DueDate: &due, Status: InstBelumJatuhTempo,
		})
	}

	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: transactionID, Actor: actor.EmployeeID,
		Action: "schedule:created",
		After:  map[string]any{"scheme": scheme, "installments": len(created), "total": totalMoney.Decimal()},
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

// ChangeScheme changes a transaction's payment scheme with a mandatory logged
// reason (M5 §4 Rule 5 + M5-OA-6). Authority: minimum SPV/Head Finance (Finance
// lead) or Director. It never deletes the existing transaction or installments —
// only updates the scheme column and appends a before->after audit row.
func (s *Service) ChangeScheme(ctx context.Context, actor permission.Actor, transactionID, newScheme, reason string) error {
	if !canChangeScheme(actor) {
		return ErrForbidden
	}
	if reason == "" || !validScheme(newScheme) {
		return ErrIncomplete
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var oldScheme string
	err = tx.QueryRowContext(ctx,
		`SELECT payment_intent_scheme FROM transactions WHERE id = ? FOR UPDATE`, transactionID).Scan(&oldScheme)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE transactions SET payment_intent_scheme = ? WHERE id = ?`, newScheme, transactionID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: transactionID, Actor: actor.EmployeeID,
		Action: "scheme:changed",
		Before: map[string]string{"payment_intent_scheme": oldScheme},
		After:  map[string]string{"payment_intent_scheme": newScheme, "reason": reason},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func validScheme(s string) bool {
	switch s {
	case SchemeLunas, SchemeBayarSebagian, SchemeTermin, SchemeBayarDiBelakang:
		return true
	}
	return false
}

// canManageIntent reports whether the actor may set intent-time schedule data
// (M5 §4 Flow 1): Finance, Director, the client's Sales PIC / allocation member,
// or a Sales Lead.
func canManageIntent(a permission.Actor, salesPIC string, allocationMember bool) bool {
	if a.Role.Director {
		return true
	}
	switch a.Role.Division {
	case FinanceDivision:
		return true
	case SalesDivision:
		return a.Role.Level == permission.LevelLead || a.EmployeeID == salesPIC || allocationMember
	}
	return false
}

// canChangeScheme is the M5-OA-6 authority: Finance Lead (SPV/Head) or Director.
func canChangeScheme(a permission.Actor) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Division == FinanceDivision && a.Role.Level == permission.LevelLead
}

func isAllocationMember(ctx context.Context, q queryRower, clientID, employeeID string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM client_sales_allocations WHERE client_id = ? AND salesperson_id = ? LIMIT 1`,
		clientID, employeeID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
