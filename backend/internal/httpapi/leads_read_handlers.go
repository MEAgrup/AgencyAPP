package httpapi

import (
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// leadViewJSON is the pinned API projection of a lead (list + detail share it).
// active_owners is always a (possibly empty) array, never null; winning_attempt_id
// is null when unresolved.
func leadViewJSON(l module1_leads.LeadView) map[string]any {
	owners := make([]map[string]any, len(l.ActiveOwners))
	for i, o := range l.ActiveOwners {
		owners[i] = map[string]any{"employee_id": o.EmployeeID, "name": o.Name}
	}
	return map[string]any{
		"id":                 l.ID,
		"lead_name":          l.LeadName,
		"phone_number":       l.PhoneNumber,
		"source":             l.Source,
		"record_status":      l.RecordStatus,
		"origin_division":    l.OriginDivision,
		"manual_review_flag": l.ManualReviewFlag,
		"stale":              l.Stale,
		"active_owners":      owners,
		"winning_attempt_id": l.WinningAttemptID,
		"created_at":         l.CreatedAt.Format(time.RFC3339),
	}
}

func (a *App) handleListLeads(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	view := r.URL.Query().Get("view")
	if view == "" {
		view = module1_leads.ViewPool
	}
	q := r.URL.Query().Get("q")
	leads, err := a.leadsSvc().ListLeads(r.Context(), actor, view, q)
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	out := make([]map[string]any, len(leads))
	for i, l := range leads {
		out[i] = leadViewJSON(l)
	}
	writeJSON(w, http.StatusOK, map[string]any{"leads": out})
}

func (a *App) handleGetLead(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	lead, attempts, err := a.leadsSvc().GetLead(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	att := make([]map[string]any, len(attempts))
	for i, at := range attempts {
		att[i] = map[string]any{
			"id":                at.ID,
			"owner_employee_id": at.OwnerEmployeeID,
			"owner_name":        at.OwnerName,
			"status":            at.Status,
			"created_at":        at.CreatedAt.Format(time.RFC3339),
			"is_winner":         at.IsWinner,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"lead": leadViewJSON(lead), "attempts": att})
}
