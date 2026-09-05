package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module8_ads"
)

// adsSvc builds the Module 8 (Ads) service. Module 8 Cluster 1 emits NOTHING (the
// FROZEN catalog has no ad-campaign event), so no Catalog wiring is required here;
// handlers never emit. The setup Brief's M12 submit guard (M8 §4 Rule 3) is a
// separate concern owned by taskSvc and is intentionally NOT wired here — that gate
// is out of scope for this cluster (DECISIONS W2-M8-C1 §4 / W2-API-1).
func (a *App) adsSvc() *module8_ads.Service {
	return &module8_ads.Service{DB: a.DB, Engine: a.Engine, Catalog: a.Catalog}
}

// ---- Ad Campaign creation + read (M8 §4 / §9.1) ----

type createCampaignBody struct {
	Platform  string `json:"platform"`
	Objective string `json:"objective"`
	Budget    string `json:"budget"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	TargetKPI string `json:"target_kpi"`
}

func (a *App) handleCreateCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b createCampaignBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	c, err := a.adsSvc().CreateCampaign(r.Context(), actor, r.PathValue("id"), module8_ads.CampaignInput{
		Platform: b.Platform, Objective: b.Objective, Budget: b.Budget,
		StartDate: b.StartDate, EndDate: b.EndDate, TargetKPI: b.TargetKPI,
	})
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *App) handleGetCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	c, err := a.adsSvc().GetCampaign(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// ---- Lifecycle (M8 §9.3 / §4 Flow 2) ----

func (a *App) handleLaunchCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.adsSvc().LaunchCampaign(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleResumeCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.adsSvc().ResumeCampaign(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handlePauseCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.adsSvc().PauseCampaign(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleEndCampaign(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.adsSvc().EndCampaign(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Creative-Asset linkage (M8 §4 Rule 2) ----

type linkAssetBody struct {
	AssetID string `json:"asset_id"`
}

func (a *App) handleLinkAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b linkAssetBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.adsSvc().LinkAsset(r.Context(), actor, r.PathValue("id"), b.AssetID); err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "asset_id": b.AssetID, "linked": true})
}

func (a *App) handleUnlinkAsset(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.adsSvc().UnlinkAsset(r.Context(), actor, r.PathValue("id"), r.PathValue("assetId")); err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "asset_id": r.PathValue("assetId"), "linked": false})
}

// ---- Metric Entries (M8 §5) — append-only ----

type metricEntryBody struct {
	PeriodStart string   `json:"period_start"`
	PeriodEnd   string   `json:"period_end"`
	Spend       string   `json:"spend"`
	GMV         string   `json:"gmv"`
	CTR         *float64 `json:"ctr"`
	CVR         *float64 `json:"cvr"`
	EntryMethod string   `json:"entry_method"`
}

func (a *App) handleLogMetricEntry(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b metricEntryBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	m, err := a.adsSvc().LogMetricEntry(r.Context(), actor, r.PathValue("id"), module8_ads.MetricInput{
		PeriodStart: b.PeriodStart, PeriodEnd: b.PeriodEnd, Spend: b.Spend, GMV: b.GMV,
		CTR: b.CTR, CVR: b.CVR, EntryMethod: b.EntryMethod,
	})
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (a *App) handleListMetricEntries(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.adsSvc().ListMetricEntries(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

// ---- Optimization Log (M8 §6) — append-only ----

type optimizationBody struct {
	ChangeType  string `json:"change_type"`
	BeforeValue string `json:"before_value"`
	AfterValue  string `json:"after_value"`
	Reason      string `json:"reason"`
	OldAssetID  string `json:"old_asset_id"`
	NewAssetID  string `json:"new_asset_id"`
}

func (a *App) handleLogOptimization(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b optimizationBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	o, err := a.adsSvc().LogOptimization(r.Context(), actor, r.PathValue("id"), module8_ads.OptimizationInput{
		ChangeType: b.ChangeType, BeforeValue: b.BeforeValue, AfterValue: b.AfterValue,
		Reason: b.Reason, OldAssetID: b.OldAssetID, NewAssetID: b.NewAssetID,
	})
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (a *App) handleListOptimizations(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.adsSvc().ListOptimizations(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAdsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

// writeAdsErr maps M8 sentinels to HTTP status + their verbatim BI message, following
// the account_handlers.go convention (forbidden->403, not-found->404, domain-validation
// ->422; statemachine BlockedError->422, RoleError->403). ErrBudgetApprovalRequired is
// an authority gate (the actor lacks >50% sign-off, M8-OA-3) -> 403.
func writeAdsErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module8_ads.ErrCampaignViewForbidden),
		errors.Is(err, module8_ads.ErrCampaignManageForbidden),
		errors.Is(err, module8_ads.ErrBudgetApprovalRequired):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module8_ads.ErrCampaignNotFound),
		errors.Is(err, module8_ads.ErrBriefNotFound),
		errors.Is(err, module8_ads.ErrAssetNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module8_ads.ErrIncomplete),
		errors.Is(err, module8_ads.ErrNotAdsBrief),
		errors.Is(err, module8_ads.ErrBriefNotInProgress),
		errors.Is(err, module8_ads.ErrInvalidPlatform),
		errors.Is(err, module8_ads.ErrInvalidCampaignDates),
		errors.Is(err, module8_ads.ErrAssetNotApproved),
		errors.Is(err, module8_ads.ErrAssetWrongClient),
		errors.Is(err, module8_ads.ErrAssetAlreadyLinked),
		errors.Is(err, module8_ads.ErrAssetNotLinked),
		errors.Is(err, module8_ads.ErrLaunchBriefNotApproved),
		errors.Is(err, module8_ads.ErrLaunchAssetsNotApproved),
		errors.Is(err, module8_ads.ErrInvalidEntryMethod),
		errors.Is(err, module8_ads.ErrNegativeAmount),
		errors.Is(err, module8_ads.ErrInvalidPeriod),
		errors.Is(err, module8_ads.ErrCampaignEnded),
		errors.Is(err, module8_ads.ErrInvalidChangeType),
		errors.Is(err, module8_ads.ErrCampaignIncompleteForSubmit),
		errors.Is(err, module8_ads.ErrBadAmount):
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
