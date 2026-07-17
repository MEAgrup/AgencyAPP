package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
)

// accountSvc builds the Module 6 service (Cluster 1 intake & AM assignment +
// Cluster 2 Strategy & Plan). The engine is used by the STR- / Service machines.
func (a *App) accountSvc() *module6_account.Service {
	return &module6_account.Service{DB: a.DB, Engine: a.Engine, Catalog: a.Catalog}
}

func (a *App) handleAccountIntake(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	q, err := a.accountSvc().IntakeQueue(r.Context(), actor)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": q})
}

func (a *App) handleAccountWorkload(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	wl, err := a.accountSvc().Workload(r.Context(), actor)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": wl})
}

type assignAMBody struct {
	AMID string `json:"am_id"`
}

func (a *App) handleAssignAM(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body assignAMBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module6_account.ErrInvalidAM.Error())
		return
	}
	res, err := a.accountSvc().AssignAM(r.Context(), actor, r.PathValue("id"), body.AMID)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type reassignAMBody struct {
	AMID   string `json:"am_id"`
	Reason string `json:"reason"`
}

func (a *App) handleReassignAM(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var body reassignAMBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, module6_account.ErrInvalidAM.Error())
		return
	}
	res, err := a.accountSvc().ReassignAM(r.Context(), actor, r.PathValue("id"), body.AMID, body.Reason)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// writeAccountErr maps M6 sentinels to HTTP status + their verbatim BI message.
func writeAccountErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, module6_account.ErrIntakeForbidden),
		errors.Is(err, module6_account.ErrAssignForbidden),
		errors.Is(err, module6_account.ErrNotOwnerAM),
		errors.Is(err, module6_account.ErrApproveForbidden),
		errors.Is(err, module6_account.ErrStrategyForbidden),
		errors.Is(err, module6_account.ErrBriefCreateForbidden),
		errors.Is(err, module6_account.ErrBriefForbidden),
		errors.Is(err, module6_account.ErrQueueForbidden),
		errors.Is(err, module6_account.ErrBriefReviewForbidden),
		errors.Is(err, module6_account.ErrComplaintForbidden),
		errors.Is(err, module6_account.ErrLogComplaintForbidden),
		errors.Is(err, module6_account.ErrComplaintManageForbidden),
		errors.Is(err, module6_account.ErrOverrideForbidden):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, module6_account.ErrNotFound),
		errors.Is(err, module6_account.ErrServiceNotFound),
		errors.Is(err, module6_account.ErrStrategyNotFound),
		errors.Is(err, module6_account.ErrBriefNotFound),
		errors.Is(err, module6_account.ErrComplaintNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, module6_account.ErrAlreadyAssigned),
		errors.Is(err, module6_account.ErrNotAssigned),
		errors.Is(err, module6_account.ErrInvalidAM),
		errors.Is(err, module6_account.ErrSameAM),
		errors.Is(err, module6_account.ErrReasonRequired),
		errors.Is(err, module6_account.ErrNotPlanGated),
		errors.Is(err, module6_account.ErrServiceNotAwaiting),
		errors.Is(err, module6_account.ErrStrategyExists),
		errors.Is(err, module6_account.ErrNotDraft),
		errors.Is(err, module6_account.ErrRevisionNotesRequired),
		errors.Is(err, module6_account.ErrInvalidDivisions),
		errors.Is(err, module6_account.ErrIncomplete),
		errors.Is(err, module6_account.ErrStrategyRequired),
		errors.Is(err, module6_account.ErrServiceNotBriefable),
		errors.Is(err, module6_account.ErrInvalidDivision),
		errors.Is(err, module6_account.ErrInvalidPriority),
		errors.Is(err, module6_account.ErrBriefStrategyMismatch),
		errors.Is(err, module6_account.ErrBriefStrategyNotAllowed),
		errors.Is(err, module6_account.ErrInvalidSeverity),
		errors.Is(err, module6_account.ErrInvalidRelatedRef),
		errors.Is(err, module6_account.ErrResolutionNotesRequired),
		errors.Is(err, module6_account.ErrOverrideReasonRequired),
		errors.Is(err, module6_account.ErrOverrideNotAwaiting):
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

type strategyBody struct {
	Objective           string   `json:"objective"`
	TargetKPI           string   `json:"target_kpi"`
	DivisionsInvolved   []string `json:"divisions_involved"`
	PlannedBriefOutline string   `json:"planned_brief_outline"`
	TimelineStart       string   `json:"timeline_start"`
	TimelineEnd         string   `json:"timeline_end"`
}

func (b strategyBody) input() module6_account.StrategyInput {
	return module6_account.StrategyInput{
		Objective: b.Objective, TargetKPI: b.TargetKPI, DivisionsInvolved: b.DivisionsInvolved,
		PlannedBriefOutline: b.PlannedBriefOutline, TimelineStart: b.TimelineStart, TimelineEnd: b.TimelineEnd,
	}
}

func (a *App) handleListStrategies(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.accountSvc().ListStrategies(r.Context(), actor)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleGetStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	st, err := a.accountSvc().GetStrategy(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *App) handleCreateStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b strategyBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	st, err := a.accountSvc().CreateStrategy(r.Context(), actor, r.PathValue("id"), b.input())
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *App) handleUpdateStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b strategyBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.accountSvc().UpdateDraft(r.Context(), actor, r.PathValue("id"), b.input()); err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id")})
}

func (a *App) handleSubmitStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.accountSvc().SubmitStrategy(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleApproveStrategy(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	if err := a.accountSvc().ApproveStrategy(r.Context(), actor, r.PathValue("id")); err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "status": module6_account.StrategyStatusApproved})
}

type revisionBody struct {
	Notes string `json:"notes"`
}

func (a *App) handleRequestStrategyRevision(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b revisionBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	if err := a.accountSvc().RequestRevision(r.Context(), actor, r.PathValue("id"), b.Notes); err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "status": module6_account.StrategyStatusDrafting})
}

// strategyRequirementBody carries a per-engagement plan-flag override (M6-OA-1).
type strategyRequirementBody struct {
	RequiresStrategyPlan bool   `json:"requires_strategy_plan"`
	Reason               string `json:"reason"`
}

// handleSetStrategyRequirement overrides a Service's "Requires Strategy Plan"
// flag for this engagement (M6-OA-1). Owning AM / Account lead / Director.
func (a *App) handleSetStrategyRequirement(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b strategyRequirementBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.accountSvc().SetStrategyRequirement(r.Context(), actor, r.PathValue("id"), b.RequiresStrategyPlan, b.Reason)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Cluster 3: Service → Brief breakdown + dispatch (M6 §5/§6) ----

type briefBody struct {
	Title                string `json:"title"`
	StrategyID           string `json:"strategy_id"`
	AssignedDivision     string `json:"assigned_division"`
	AssignedPIC          string `json:"assigned_pic"`
	DeliverableType      string `json:"deliverable_type"`
	QuantityTarget       int    `json:"quantity_target"`
	DueDate              string `json:"due_date"`
	Priority             string `json:"priority"`
	Recurring            bool   `json:"recurring"`
	RecurringFrequency   string `json:"recurring_frequency"`
	RecurringCount       int    `json:"recurring_count"`
	RecurringEndDate     string `json:"recurring_end_date"`
	Instructions         string `json:"instructions"`
	ReferenceAttachments string `json:"reference_attachments"`
	IsAddendum           bool   `json:"is_addendum"`
}

func (b briefBody) input() module6_account.BriefInput {
	return module6_account.BriefInput{
		Title: b.Title, StrategyID: b.StrategyID, AssignedDivision: b.AssignedDivision,
		AssignedPIC: b.AssignedPIC, DeliverableType: b.DeliverableType, QuantityTarget: b.QuantityTarget,
		DueDate: b.DueDate, Priority: b.Priority, Recurring: b.Recurring,
		RecurringFrequency: b.RecurringFrequency, RecurringCount: b.RecurringCount,
		RecurringEndDate: b.RecurringEndDate, Instructions: b.Instructions,
		ReferenceAttachments: b.ReferenceAttachments, IsAddendum: b.IsAddendum,
	}
}

func (a *App) handleCreateBrief(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b briefBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	brief, err := a.accountSvc().CreateBrief(r.Context(), actor, r.PathValue("id"), b.input())
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, brief)
}

func (a *App) handleGetBrief(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	brief, err := a.accountSvc().GetBrief(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, brief)
}

func (a *App) handleListServiceBriefs(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.accountSvc().ListServiceBriefs(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleDivisionQueue(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.accountSvc().ListDivisionQueue(r.Context(), actor, r.PathValue("division"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

// ---- Cluster 4 (part A): Revision routing (M6 §7) — AM-side review edges ----

func (a *App) handleReviewBrief(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.accountSvc().ReviewBrief(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleApproveBrief(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.accountSvc().ApproveBrief(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type briefRevisionBody struct {
	Feedback string `json:"feedback"`
}

func (a *App) handleRequestBriefRevision(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b briefRevisionBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.accountSvc().RequestBriefRevision(r.Context(), actor, r.PathValue("id"), b.Feedback)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- Cluster 4 (part B): Complaint door #2 (AM via WhatsApp, M6 §8) ----

type complaintBody struct {
	Description string `json:"description"`
	Severity    string `json:"severity"`
	RelatedRef  string `json:"related_ref"`
}

func (a *App) handleLogComplaint(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b complaintBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	c, err := a.accountSvc().LogComplaint(r.Context(), actor, r.PathValue("id"), module6_account.ComplaintInput{
		Description: b.Description, Severity: b.Severity, RelatedRef: b.RelatedRef,
	})
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *App) handleGetComplaint(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	c, err := a.accountSvc().GetComplaint(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *App) handleListClientComplaints(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	list, err := a.accountSvc().ListClientComplaints(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list})
}

func (a *App) handleStartComplaint(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.accountSvc().StartComplaint(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type resolveComplaintBody struct {
	Notes string `json:"notes"`
}

func (a *App) handleResolveComplaint(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	var b resolveComplaintBody
	if err := decodeJSON(r, &b); err != nil {
		writeErr(w, http.StatusBadRequest, "[format data tidak valid]")
		return
	}
	res, err := a.accountSvc().ResolveComplaint(r.Context(), actor, r.PathValue("id"), b.Notes)
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleCloseComplaint(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	res, err := a.accountSvc().CloseComplaint(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeAccountErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
