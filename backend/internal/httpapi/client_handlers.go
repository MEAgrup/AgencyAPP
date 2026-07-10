package httpapi

import (
	"errors"
	"net/http"

	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/module4_client"
)

// clientSvc builds the Module 4 service over the app's shared deps.
func (a *App) clientSvc() *module4_client.Service {
	return &module4_client.Service{DB: a.DB, Engine: a.Engine}
}

// clientView is the API projection of a Client: money fields render in the house
// IDR convention (CLAUDE.md #7) and never leak raw minor units.
func clientView(c module4_client.Client) map[string]any {
	v := map[string]any{
		"id":                        c.ID,
		"nama_pic":                  c.NamaPIC,
		"toko":                      c.Toko,
		"kota":                      c.Kota,
		"link_toko":                 c.LinkToko,
		"kategori":                  c.Kategori,
		"gmv_baseline":              c.GMVBaseline.Format(),
		"target_gmv":                c.TargetGMV.Format(),
		"total_sales":               c.TotalSales.Format(),
		"marketing_budget":          moneyPtr(c.MarketingBudget),
		"origin_campaign_id":        c.OriginCampaignID,
		"sales_pic_id":              c.SalesPICID,
		"commission_payment_pic_id": c.CommissionPaymentPICID,
		"transaction_id":            c.TransactionID,
		"payment_intent":            c.PaymentIntent,
		"released_to_account_at":    c.ReleasedToAccountAt,
		"platforms":                 c.Platforms,
		"sales_allocation":          c.Allocations,
		"services":                  serviceViews(c.Services),
	}
	return v
}

func moneyPtr(m *money.Money) any {
	if m == nil {
		return nil
	}
	return m.Format()
}

func serviceViews(ss []module4_client.ServiceLine) []map[string]any {
	out := make([]map[string]any, len(ss))
	for i, s := range ss {
		out[i] = map[string]any{
			"id":                s.ID,
			"master_service_id": s.MasterServiceID,
			"name":              s.Name,
			"standard_price":    s.StandardPrice.Format(),
			"status":            s.Status,
		}
	}
	return out
}

func (a *App) handleListClients(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	cs, err := a.clientSvc().List(r.Context(), actor)
	if err != nil {
		if errors.Is(err, module4_client.ErrForbidden) {
			writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses ke daftar klien]")
			return
		}
		writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		return
	}
	views := make([]map[string]any, len(cs))
	for i, c := range cs {
		views[i] = clientView(c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": views})
}

func (a *App) handleGetClient(w http.ResponseWriter, r *http.Request) {
	actor, _ := actorFrom(r.Context())
	c, err := a.clientSvc().Get(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		switch {
		case errors.Is(err, module4_client.ErrForbidden):
			writeErr(w, http.StatusForbidden, "[anda tidak memiliki akses ke daftar klien]")
		case errors.Is(err, module4_client.ErrNotFound):
			writeErr(w, http.StatusNotFound, "[klien tidak ditemukan]")
		default:
			writeErr(w, http.StatusInternalServerError, "[terjadi kesalahan sistem]")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"client": clientView(c)})
}
