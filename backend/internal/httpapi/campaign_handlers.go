package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module3_campaign"
)

// campaignSvc builds the Module 3 (Campaign) service. Module 3 emits NOTHING (the FROZEN
// catalog has no Campaign event), so no Catalog wiring is required; kept nil-guarded.
func (a *App) campaignSvc() *module3_campaign.Service {
	return &module3_campaign.Service{DB: a.DB, Engine: a.Engine, Catalog: a.Catalog}
}

// ---- Campaign create + read (M3 §3 / §5) ----
//
// NOTE ON PATH PREFIX: Module 8 (Ads) already owns "/api/v1/campaigns/{id}" for its Ad
// Campaign (ADC-) record, which is a frozen Wave-2 route. Registering the Module 3
// acquisition-Campaign detail route on the same pattern would panic the Go 1.22 mux
// ("conflicting patterns"). To avoid the collision AND keep the M3 surface internally
// consistent, the acquisition Campaign (CMP-) is served under "/api/v1/marketing/campaigns".
// This is a required deviation from the ticket's literal "/api/v1/campaigns" paths,
// logged for orchestrator sign-off.

type createMktCampaignBody struct {
	Name      string `json:"name"`
	Channel   string `json:"channel"`
	Online    bool   `json:"online"`
	Offline   bool   `json:"offline"`
	StartDate string `json:"start_date"`
}

func (a *App) handleCreateMarketingCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createMktCampaignBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	c, err := a.campaignSvc().Create(r.Context(), actor, module3_campaign.CampaignInput{
		Name: b.Name, Channel: b.Channel, Online: b.Online, Offline: b.Offline, StartDate: b.StartDate,
	})
	if err != nil {
		writeCampaignErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *App) handleListMarketingCampaigns(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.campaignSvc().List(r.Context(), actor)
	if err != nil {
		writeCampaignErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleGetMarketingCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	c, err := a.campaignSvc().Get(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeCampaignErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// ---- Lifecycle (M3 §3) ----

type transitionMktCampaignBody struct {
	To string `json:"to"`
}

func (a *App) handleTransitionMarketingCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b transitionMktCampaignBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.campaignSvc().Transition(r.Context(), actor, r.PathValue("id"), b.To)
	if err != nil {
		writeCampaignErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Ownership reassignment (M3 §5 / M3-OA-6) ----

type reassignMktCampaignBody struct {
	OwnerEmployeeID string `json:"owner_employee_id"`
}

func (a *App) handleReassignMarketingCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b reassignMktCampaignBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	c, err := a.campaignSvc().Reassign(r.Context(), actor, r.PathValue("id"), b.OwnerEmployeeID)
	if err != nil {
		writeCampaignErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// writeCampaignErr maps M3 sentinels to HTTP status + their verbatim BI message, following
// the account_handlers.go / ads_handlers.go convention (forbidden->403, not-found->404,
// domain-validation->422; statemachine BlockedError->422, RoleError->403).
func writeCampaignErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module3_campaign.ErrForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module3_campaign.ErrNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module3_campaign.ErrIncomplete):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	default:
		var be *statemachine.BlockedError
		var re *statemachine.RoleError
		switch {
		case errors.As(err, &be):
			writeErr(w, http.StatusUnprocessableEntity, be.Message)
		case errors.As(err, &re):
			writeErr(w, http.StatusForbidden, re.Message)
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
	}
}
