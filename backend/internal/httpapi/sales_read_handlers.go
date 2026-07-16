package httpapi

import (
	"net/http"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
)

func (a *App) handleMyAttempts(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	items, err := a.salesSvc().MyAttempts(r.Context(), actor)
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	out := make([]map[string]any, len(items))
	for i, it := range items {
		out[i] = map[string]any{
			"id":           it.ID,
			"lead_id":      it.LeadID,
			"lead_name":    it.LeadName,
			"phone_number": it.PhoneNumber,
			"status":       it.Status,
			"created_at":   it.CreatedAt.Format(time.RFC3339),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"attempts": out})
}

func (a *App) handleGetAttempt(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	d, err := a.salesSvc().AttemptDetailFor(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		a.writeDomainErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"attempt": map[string]any{
			"id":                d.Attempt.ID,
			"lead_id":           d.Attempt.LeadID,
			"owner_employee_id": d.Attempt.OwnerID,
			"owner_name":        d.Attempt.OwnerName,
			"status":            d.Attempt.Status,
			"created_at":        d.Attempt.CreatedAt.Format(time.RFC3339),
		},
		"lead": map[string]any{
			"id":            d.Lead.ID,
			"lead_name":     d.Lead.LeadName,
			"phone_number":  d.Lead.PhoneNumber,
			"record_status": d.Lead.RecordStatus,
		},
		"qualified_form": qualifiedFormJSON(d.Qualified),
		"negotiation":    negotiationJSON(d.Negotiation),
	})
}

// idrPair emits the raw DECIMAL string plus the house-formatted IDR string under
// the given key + key_idr (CLAUDE.md #7).
func idrPair(m map[string]any, key string, v money.Money) {
	m[key] = v.Decimal()
	m[key+"_idr"] = v.Format()
}

func qualifiedFormJSON(qf *module0_sales.QualifiedFormDetail) any {
	if qf == nil {
		return nil
	}
	out := map[string]any{
		"nama_pic":   qf.NamaPIC,
		"toko":       qf.Toko,
		"kota":       qf.Kota,
		"link_toko":  qf.LinkToko,
		"kategori":   qf.Kategori,
		"platform":   qf.Platform,
		"store_link": qf.StoreLink,
	}
	idrPair(out, "gmv_baseline", qf.GMVBaseline)
	idrPair(out, "target_gmv", qf.TargetGMV)
	if qf.MarketingBudget != nil {
		idrPair(out, "marketing_budget", *qf.MarketingBudget)
	} else {
		out["marketing_budget"] = nil
		out["marketing_budget_idr"] = nil
	}
	services := make([]map[string]any, len(qf.Services))
	for i, s := range qf.Services {
		svc := map[string]any{
			"master_service_id": s.MasterServiceID,
			"name":              s.Name,
			"commission_rule":   s.CommissionRule,
		}
		idrPair(svc, "standard_price", s.StandardPrice)
		services[i] = svc
	}
	out["services"] = services
	return out
}

func negotiationJSON(neg *module0_sales.NegotiationDetail) any {
	if neg == nil {
		return nil
	}
	versions := make([]map[string]any, len(neg.Versions))
	for i, v := range neg.Versions {
		lines := make([]map[string]any, len(v.Lines))
		for j, l := range v.Lines {
			line := map[string]any{
				"master_service_id": l.MasterServiceID,
				"commission_rule":   l.CommissionRule,
				"payment_terms":     l.PaymentTerms,
			}
			idrPair(line, "proposed_price", l.ProposedPrice)
			lines[j] = line
		}
		versions[i] = map[string]any{
			"id":            v.ID,
			"version_no":    v.VersionNo,
			"proposed_by":   v.ProposedBy,
			"decision_note": v.DecisionNote,
			"created_at":    v.CreatedAt.Format(time.RFC3339),
			"lines":         lines,
		}
	}
	return map[string]any{"versions": versions}
}
