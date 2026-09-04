package module0_sales_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module0_sales"
	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// TestClose_StampsClientOriginCampaign is the M3 §4 Rule 2 e2e (W3-M3-C2): a lead
// born under a Campaign carries that Origin Campaign onto the Client created at
// closing. Register (campaign) -> Qualified -> Negotiation -> Close, then assert
// clients.origin_campaign_id == the campaign. A lead WITHOUT a campaign leaves it
// NULL (control).
func TestClose_StampsClientOriginCampaign(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := salesActor("SS-1", permission.LevelStaff)

	// Seed an Active campaign (Cluster-1 table) directly — this test exercises the
	// closing stamp, not campaign creation.
	if _, err := f.d.Exec(
		`INSERT INTO campaigns (id, name, channel, is_online, is_offline, start_date, owner_employee_id, status, created_by)
		 VALUES ('CMP-202603-0007', 'Promo', 'TikTok Ads', 1, 0, '2026-03-01', 'EMP-LIA', 'Active', 'EMP-LIA')`); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}

	clientOrigin := func(t *testing.T, campaignID, phone string) sql.NullString {
		t.Helper()
		_, att, _, err := f.leads.Register(ctx, owner, module1_leads.RegisterInput{
			LeadName: "Co", PhoneNumber: phone, Source: "Referral", CampaignID: campaignID,
		})
		if err != nil {
			t.Fatalf("Register: %v", err)
		}
		if err := f.sales.MarkContacted(ctx, owner, att.ID); err != nil {
			t.Fatalf("MarkContacted: %v", err)
		}
		form := module0_sales.QualifiedForm{
			NamaPIC: "P", Toko: "T", Kota: "K", LinkToko: "L", Kategori: "C", Platform: "Shopee",
			GMVBaseline: "1000000", TargetGMV: "2000000",
			Services: []module0_sales.ServiceSelection{{MasterServiceID: f.msvc}},
		}
		if err := f.sales.SubmitQualifiedForm(ctx, owner, att.ID, form); err != nil {
			t.Fatalf("SubmitQualifiedForm: %v", err)
		}
		if err := f.sales.SubmitNegotiation(ctx, owner, att.ID, nil, true); err != nil {
			t.Fatalf("SubmitNegotiation: %v", err)
		}
		res, err := f.sales.Close(ctx, owner, att.ID, module0_sales.ClosingInput{
			Parties: module0_sales.ClosingParties{
				PrimarySalespersonID: "SS-1",
				Allocations:          []module0_sales.Allocation{{SalespersonID: "SS-1", BasisPoints: 10000}},
			},
			PaymentScheme: module0_sales.PaymentSchemeLunas,
		})
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
		var oc sql.NullString
		if err := f.d.QueryRowContext(ctx, `SELECT origin_campaign_id FROM clients WHERE id = ?`, res.ClientID).Scan(&oc); err != nil {
			t.Fatalf("read client origin: %v", err)
		}
		return oc
	}

	// Campaign-scoped lead -> Client origin stamped.
	if oc := clientOrigin(t, "CMP-202603-0007", "0812-3456"); !oc.Valid || oc.String != "CMP-202603-0007" {
		t.Fatalf("client origin = %v, want CMP-202603-0007", oc)
	}
	// No campaign -> Client origin NULL (control).
	if oc := clientOrigin(t, "", "0812-9999"); oc.Valid {
		t.Fatalf("no-campaign client origin = %q, want NULL", oc.String)
	}
}
