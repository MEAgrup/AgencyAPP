package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// financeSvc builds the Module 5 service over the app's shared deps.
func (a *App) financeSvc() *module5_finance.Service {
	return &module5_finance.Service{DB: a.DB, Engine: a.Engine}
}

// trxView is the API projection of a Transaction: money renders in the house IDR
// convention (CLAUDE.md #7); Amount Verified / Outstanding are recomputed, never
// stored raw.
func trxView(r module5_finance.TransactionRecord) map[string]any {
	return map[string]any{
		"id":                     r.ID,
		"client_id":              r.ClientID,
		"payment_intent_scheme":  r.Scheme,
		"total_agreed_value":     r.Total.Format(),
		"amount_verified":        r.AmountVerified.Format(),
		"amount_outstanding":     r.AmountOutstanding.Format(),
		"payment_status":         r.Status,
		"bermasalah":             r.Bermasalah,
		"contract_attachment":    r.ContractAttachment,
		"released_to_account_at": r.ReleasedToAccountAt,
		"installments":           instViews(r.Installments),
	}
}

func instViews(is []module5_finance.InstallmentRow) []map[string]any {
	out := make([]map[string]any, len(is))
	for i, it := range is {
		out[i] = map[string]any{
			"id":               it.ID,
			"installment_no":   it.InstallmentNo,
			"amount":           it.Amount.Format(),
			"due_date":         it.DueDate,
			"status":           it.Status,
			"jatuh_tempo":      it.JatuhTempo,
			"verified_date":    it.VerifiedDate,
			"verified_by":      it.VerifiedBy,
			"proof_of_payment": it.ProofOfPayment,
		}
	}
	return out
}

func (a *App) handleFinanceQueue(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	recs, err := a.financeSvc().Queue(r.Context(), actor)
	if err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	views := make([]map[string]any, len(recs))
	for i, rec := range recs {
		views[i] = trxView(rec)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": views})
}

func (a *App) handleGetTransaction(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	rec, err := a.financeSvc().LoadTransaction(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transaction": trxView(rec)})
}

type scheduleItemBody struct {
	Amount  string `json:"amount"`
	DueDate string `json:"due_date"`
}

type scheduleBody struct {
	Items []scheduleItemBody `json:"items"`
}

func (a *App) handleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body scheduleBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	items := make([]module5_finance.ScheduleItem, 0, len(body.Items))
	for _, it := range body.Items {
		amt, err := money.Parse(it.Amount)
		if err != nil {
			writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
			return
		}
		due, err := time.Parse("2006-01-02", it.DueDate)
		if err != nil {
			writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
			return
		}
		items = append(items, module5_finance.ScheduleItem{Amount: amt, DueDate: due})
	}
	created, err := a.financeSvc().CreateSchedule(r.Context(), actor, r.PathValue("id"), items)
	if err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"installments": instViews(created)})
}

type verifyBody struct {
	InstallmentID string `json:"installment_id"`
	Amount        string `json:"amount"`
	ReceivedDate  string `json:"received_date"`
	Proof         string `json:"proof_of_payment"`
}

func (a *App) handleVerify(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body verifyBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	amt, err := money.Parse(body.Amount)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	received, err := time.Parse("2006-01-02", body.ReceivedDate)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	rec, err := a.financeSvc().Verify(r.Context(), actor, r.PathValue("id"), module5_finance.VerifyRequest{
		InstallmentID: body.InstallmentID,
		Amount:        amt,
		ReceivedDate:  received,
		Proof:         body.Proof,
	})
	if err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transaction": trxView(rec)})
}

type contractBody struct {
	Link string `json:"contract_attachment"`
}

func (a *App) handleAttachContract(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body contractBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	if err := a.financeSvc().AttachContract(r.Context(), actor, r.PathValue("id"), body.Link); err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

type schemeBody struct {
	Scheme string `json:"payment_intent_scheme"`
	Reason string `json:"reason"`
}

func (a *App) handleChangeScheme(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body schemeBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	if err := a.financeSvc().ChangeScheme(r.Context(), actor, r.PathValue("id"), body.Scheme, body.Reason); err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

// MsgFinanceAccessDenied is the pure permission-gate denial for Module 5
// endpoints (Queue/LoadTransaction/Verify/CreateSchedule/ChangeScheme/
// FlagBermasalah/VoteBermasalah's division/level checks, module5_finance.
// ErrForbidden) — distinct from statemachine.RoleDeniedMessage, which is
// reserved for an actual state-machine transition role denial. Reads like GET
// /finance/queue were previously (mis)reported with the transition-denial
// string even though no transition was ever attempted.
const MsgFinanceAccessDenied = "[anda tidak memiliki akses ke data keuangan ini]"

// writeFinanceErr maps Module 5 domain errors to HTTP status + exact BI message.
func (a *App) writeFinanceErr(w http.ResponseWriter, err error) {
	var blocked *statemachine.BlockedError
	var roleErr *statemachine.RoleError
	switch {
	case errors.Is(err, module5_finance.ErrNotFound):
		writeErr(w, http.StatusNotFound, "[transaksi tidak ditemukan]")
	case errors.Is(err, module5_finance.ErrForbidden):
		writeErr(w, http.StatusForbidden, MsgFinanceAccessDenied)
	case errors.Is(err, module5_finance.ErrContractRequired):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgContractRequired)
	case errors.Is(err, module5_finance.ErrScheduleExists):
		writeErr(w, http.StatusConflict, module5_finance.MsgScheduleExists)
	case errors.Is(err, module5_finance.ErrOverVerified):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.OverVerifiedMessage)
	case errors.Is(err, module5_finance.ErrTerminMismatch):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.TerminMismatchMessage)
	case errors.Is(err, module5_finance.ErrSchemeNoSchedule):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgSchemeNoSchedule)
	case errors.Is(err, module5_finance.ErrInstallmentNotInTrx):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgInstallmentNotInTrx)
	case errors.Is(err, module5_finance.ErrInstallmentAmount):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgInstallmentAmount)
	case errors.Is(err, module5_finance.ErrDirectOnScheduled):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgDirectOnScheduled)
	case errors.Is(err, module5_finance.ErrIncomplete), errors.Is(err, module5_finance.ErrEmptySchedule):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
	case errors.As(err, &roleErr):
		writeErr(w, http.StatusForbidden, roleErr.Message)
	case errors.As(err, &blocked):
		writeErr(w, http.StatusUnprocessableEntity, blocked.Message)
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}
