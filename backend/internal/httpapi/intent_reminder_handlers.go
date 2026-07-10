package httpapi

// intent_reminder_handlers.go wires the Stage 3 endpoints of build stream B
// (Alur 2 — Client & Finance): the Module 4 §5 payment-intent handoff
// (W1-13), the Module 5 §6 reminder dashboard/scan (W1-17), and the Module 5
// §5 Rule 5 / M5-OA-5 [Bermasalah] flag + joint resolution (W1-18). Kept in
// one new file per the Stage 3 file-ownership plan, rather than editing the
// existing client_handlers.go / finance_handlers.go.

import (
	"errors"
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module4_client"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// ---- W1-13: payment-intent handoff ----

type paymentIntentBody struct {
	PaymentIntent string `json:"payment_intent"`
}

func (a *App) handleSetPaymentIntent(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body paymentIntentBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module4_client.MsgIncomplete)
		return
	}
	clientID := r.PathValue("id")
	if err := a.clientSvc().SetPaymentIntent(r.Context(), actor, clientID, body.PaymentIntent); err != nil {
		a.writeIntentErr(w, err)
		return
	}
	// Re-fetch for the response; the handoff itself already committed.
	c, err := a.clientSvc().Get(r.Context(), actor, clientID)
	if err != nil {
		a.writeIntentErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"client": clientView(c)})
}

func (a *App) writeIntentErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module4_client.ErrNotFound):
		writeErr(w, http.StatusNotFound, "[klien tidak ditemukan]")
	case errors.Is(err, module4_client.ErrForbidden):
		writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses ke daftar klien]")
	case errors.Is(err, module4_client.ErrIntentForbidden):
		writeErr(w, http.StatusForbidden, statemachine.RoleDeniedMessage)
	case errors.Is(err, module4_client.ErrIntentLocked):
		writeErr(w, http.StatusConflict, module4_client.MsgIntentLocked)
	case errors.Is(err, module4_client.ErrInvalidField):
		writeErr(w, http.StatusUnprocessableEntity, module4_client.MsgIncomplete)
	default:
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
	}
}

// ---- W1-17: reminder dashboard + scan ----

func reminderViews(rows []module5_finance.ReminderRow) []map[string]any {
	out := make([]map[string]any, len(rows))
	for i, r := range rows {
		out[i] = map[string]any{
			"client_id":      r.ClientID,
			"toko":           r.Toko,
			"transaction_id": r.TransactionID,
			"installment_id": r.InstallmentID,
			"installment_no": r.InstallmentNo,
			"amount":         r.Amount.Format(),
			"due_date":       r.DueDate.Format("2006-01-02"),
			"status":         r.Status,
			"days_overdue":   r.DaysOverdue,
			"label":          r.Label,
		}
	}
	return out
}

func outstandingViews(rows []module5_finance.OutstandingRow) []map[string]any {
	out := make([]map[string]any, len(rows))
	for i, r := range rows {
		out[i] = map[string]any{
			"client_id":          r.ClientID,
			"toko":               r.Toko,
			"transaction_id":     r.TransactionID,
			"amount_outstanding": r.AmountOutstanding.Format(),
		}
	}
	return out
}

func (a *App) handleFinanceReminders(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	dash, err := a.financeSvc().Dashboard(r.Context(), a.Catalog, actor, time.Now())
	if err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"reminders":               reminderViews(dash.Reminders),
		"outstanding_no_due_date": outstandingViews(dash.OutstandingNoDueDate),
	})
}

func (a *App) handleScanReminders(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.financeSvc().RunScan(r.Context(), a.Catalog, actor, time.Now())
	if err != nil {
		a.writeFinanceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- W1-18: [Bermasalah] flag + joint resolution ----

type bermasalahFlagBody struct {
	Reason string `json:"reason"`
}

func (a *App) handleFlagBermasalah(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body bermasalahFlagBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	if err := a.financeSvc().FlagBermasalah(r.Context(), actor, r.PathValue("id"), body.Reason); err != nil {
		a.writeReminderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

type bermasalahVoteBody struct {
	Decision string `json:"decision"`
	Note     string `json:"note"`
}

func (a *App) handleResolveBermasalah(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body bermasalahVoteBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgIncomplete)
		return
	}
	if err := a.financeSvc().VoteBermasalah(r.Context(), actor, r.PathValue("id"), body.Decision, body.Note); err != nil {
		a.writeReminderErr(w, err)
		return
	}
	status, err := a.financeSvc().GetBermasalahStatus(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeReminderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (a *App) handleGetBermasalah(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	status, err := a.financeSvc().GetBermasalahStatus(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeReminderErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// writeReminderErr extends the shared Module 5 error mapping (writeFinanceErr,
// finance_handlers.go) with the two new [Bermasalah] guards.
func (a *App) writeReminderErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module5_finance.ErrNotBermasalah):
		writeErr(w, http.StatusUnprocessableEntity, module5_finance.MsgNotBermasalah)
	case errors.Is(err, module5_finance.ErrAlreadyBermasalah):
		writeErr(w, http.StatusConflict, module5_finance.MsgAlreadyBermasalah)
	default:
		a.writeFinanceErr(w, err)
	}
}
