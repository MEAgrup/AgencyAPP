package httpapi

import (
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

// salesSvc builds the Module 0 service, binding the WinResolverFunc to Module 1
// win resolution so a closing atomically resolves pool competition.
func (a *App) salesSvc() *module0_sales.Service {
	leads := a.leadsSvc()
	return &module0_sales.Service{
		DB:      a.DB,
		Engine:  a.Engine,
		Catalog: a.Catalog,
		Win:     leads.ResolveWin,
	}
}

func (a *App) handleMarkContacted(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.salesSvc().MarkContacted(r.Context(), actor, r.PathValue("id")); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": module0_sales.StatusContacted})
}

func (a *App) handleQualify(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var form module0_sales.QualifiedForm
	if err := decodeJSON(r, &form); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	if err := a.salesSvc().SubmitQualifiedForm(r.Context(), actor, r.PathValue("id"), form); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": module0_sales.StatusQualified})
}

func (a *App) handleNotQualified(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		Reasons     []string `json:"reasons"`
		LainnyaText string   `json:"lainnya_text"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	if err := a.salesSvc().SetNotQualified(r.Context(), actor, r.PathValue("id"), body.Reasons, body.LainnyaText); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": module0_sales.StatusNotQualified})
}

func (a *App) handleSubmitNegotiation(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		Lines  []module0_sales.ProposalLine `json:"lines"`
		NoNego bool                         `json:"no_nego"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	if err := a.salesSvc().SubmitNegotiation(r.Context(), actor, r.PathValue("id"), body.Lines, body.NoNego); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) handleDecideNegotiation(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	if err := a.salesSvc().DecideNegotiation(r.Context(), actor, r.PathValue("id"), body.Decision, body.Note); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) handleAcceptCounter(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.salesSvc().AcceptCounter(r.Context(), actor, r.PathValue("id")); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": module0_sales.StatusNegApproved})
}

func (a *App) handleResubmitNegotiation(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		Lines []module0_sales.ProposalLine `json:"lines"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	if err := a.salesSvc().Resubmit(r.Context(), actor, r.PathValue("id"), body.Lines); err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) handleClose(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body struct {
		Parties       module0_sales.ClosingParties `json:"parties"`
		PaymentScheme string                       `json:"payment_scheme"`
		ManagedSince  string                       `json:"managed_since"`
		Installments  []closingInstallmentJSON     `json:"installments"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, module0_sales.IncompleteMessage)
		return
	}
	in := module0_sales.ClosingInput{
		Parties:       body.Parties,
		PaymentScheme: body.PaymentScheme,
		ManagedSince:  body.ManagedSince,
	}
	for _, it := range body.Installments {
		due, _ := time.Parse("2006-01-02", it.DueDate)
		in.Installments = append(in.Installments, module0_sales.InstallmentInput{Amount: it.Amount, DueDate: due})
	}
	res, err := a.salesSvc().Close(r.Context(), actor, r.PathValue("id"), in)
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

type closingInstallmentJSON struct {
	Amount  string `json:"amount"`
	DueDate string `json:"due_date"`
}
