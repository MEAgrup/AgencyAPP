package module4_client

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func newService(t *testing.T) *Service {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Engine: statemachine.New()}
}

func salesStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: SalesDivision, Level: permission.LevelStaff}}
}
func salesLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: SalesDivision, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func odActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}
func directorActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func execStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Creative", Level: permission.LevelStaff}}
}

// seedAlphaDigital inserts the Module 4 §3 worked example exactly (closing-time
// INSERT, as Sales/W1-09 would produce it against the 0002 schema).
func seedAlphaDigital(t *testing.T, s *Service) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO clients
		 (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, marketing_budget,
		  total_sales, origin_campaign_id, sales_pic_id, commission_payment_pic_id, transaction_id, created_by)
		 VALUES ('CLI-202605-0021', 'Pak Alpha', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
		         'Fashion', '50000000.00', '100000000.00', '10000000.00', '0.00', NULL,
		         'EMP-BUDI', 'EMP-BUDI', 'TRX-202605-0021', 'EMP-BUDI')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO client_platforms (client_id, platform, store_link, active, created_by) VALUES
		 ('CLI-202605-0021', 'Shopee', 'https://shopee.co.id/alpha', 1, 'EMP-BUDI'),
		 ('CLI-202605-0021', 'TikTok Shop', 'https://tiktok.com/@alpha', 1, 'EMP-BUDI')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
		 VALUES ('CLI-202605-0021', 'EMP-BUDI', 10000, 'EMP-BUDI')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by) VALUES
		 ('SVC-202605-0031', 'CLI-202605-0021', 'MSV-01', 1, 'Pendampingan Establish TikTok', '15000000.00', '10% of standard price', '[Briefed]', 'EMP-BUDI'),
		 ('SVC-202605-0032', 'CLI-202605-0021', 'MSV-02', 1, 'Jasa Buka Toko Online Basic', '5000000.00', 'flat Rp 500000', '[Briefed]', 'EMP-BUDI'),
		 ('SVC-202605-0033', 'CLI-202605-0021', 'MSV-03', 1, 'Jasa Live Streaming Basic', '8000000.00', 'flat Rp 800000', '[Briefed]', 'EMP-BUDI')`); err != nil {
		t.Fatal(err)
	}
}

func TestGetReproducesAlphaDigital(t *testing.T) {
	s := newService(t)
	seedAlphaDigital(t, s)

	c, err := s.Get(context.Background(), directorActor("EMP-DIR"), "CLI-202605-0021")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	// Identity/baseline fields, field-for-field (M4 §3).
	if c.NamaPIC != "Pak Alpha" || c.Toko != "Alpha Digital" || c.Kota != "Bandung" ||
		c.Kategori != "Fashion" || c.LinkToko != "https://shopee.co.id/alpha" {
		t.Errorf("identity mismatch: %+v", c)
	}
	if c.SalesPICID != "EMP-BUDI" || c.CommissionPaymentPICID != "EMP-BUDI" {
		t.Errorf("PIC mismatch: sales=%q comm=%q", c.SalesPICID, c.CommissionPaymentPICID)
	}
	if c.TransactionID != "TRX-202605-0021" {
		t.Errorf("transaction id = %q", c.TransactionID)
	}
	if c.OriginCampaignID != "" {
		t.Errorf("origin campaign should be empty (scouted), got %q", c.OriginCampaignID)
	}
	// Money formats to the house convention.
	if got := c.GMVBaseline.Format(); got != "Rp. 50.000.000,00" {
		t.Errorf("gmv baseline = %q", got)
	}
	if got := c.TargetGMV.Format(); got != "Rp. 100.000.000,00" {
		t.Errorf("target gmv = %q", got)
	}
	if c.MarketingBudget == nil || c.MarketingBudget.Format() != "Rp. 10.000.000,00" {
		t.Errorf("marketing budget = %v", c.MarketingBudget)
	}
	if got := c.TotalSales.Format(); got != "Rp. 0,00" {
		t.Errorf("total sales = %q (want auto 0)", got)
	}
	// Provenance: 2 platforms, allocation Σ=10000, 3 services incl. Live Streaming.
	if len(c.Platforms) != 2 {
		t.Fatalf("platforms = %d, want 2", len(c.Platforms))
	}
	sumBP := 0
	for _, a := range c.Allocations {
		sumBP += a.BasisPoints
	}
	if sumBP != 10000 {
		t.Errorf("allocation Σ basis_points = %d, want 10000", sumBP)
	}
	if len(c.Services) != 3 {
		t.Fatalf("services = %d, want 3", len(c.Services))
	}
	var hasLive bool
	for _, sl := range c.Services {
		if sl.Name == "Jasa Live Streaming Basic" {
			hasLive = true
		}
	}
	if !hasLive {
		t.Errorf("expected Jasa Live Streaming Basic in service set")
	}
}

// insertClient is a minimal client-birth helper for visibility tests.
func insertClient(t *testing.T, s *Service, id, salesPIC string, released bool, allocMembers ...string) {
	t.Helper()
	ctx := context.Background()
	rel := "NULL"
	if released {
		rel = "NOW()"
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		  total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, created_by)
		 VALUES (?, 'PIC', ?, 'Kota', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00', ?, ?, `+rel+`, 'TEST')`,
		id, id, salesPIC, salesPIC); err != nil {
		t.Fatal(err)
	}
	for _, m := range allocMembers {
		if _, err := s.DB.ExecContext(ctx,
			`INSERT INTO client_sales_allocations (client_id, salesperson_id, basis_points, created_by) VALUES (?, ?, ?, 'TEST')`,
			id, m, 10000/len(allocMembers)); err != nil {
			t.Fatal(err)
		}
	}
}

// assignAM sets a client's current AM pointer (migration 0020) directly, so the
// visibility tests need not pull in Module 6's assignment service.
func assignAM(t *testing.T, s *Service, clientID, amID string) {
	t.Helper()
	if _, err := s.DB.ExecContext(context.Background(),
		`UPDATE clients SET assigned_am_id = ? WHERE id = ?`, amID, clientID); err != nil {
		t.Fatal(err)
	}
}

func canSee(t *testing.T, s *Service, actor permission.Actor, id string) bool {
	t.Helper()
	_, err := s.Get(context.Background(), actor, id)
	if err == nil {
		return true
	}
	if errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) {
		return false
	}
	t.Fatalf("Get(%s): unexpected error %v", id, err)
	return false
}

func TestVisibilityMatrix(t *testing.T) {
	s := newService(t)
	// Budi owns CLI-A (not released). CLI-B owned by Budi but allocation includes Citra.
	insertClient(t, s, "CLI-A", "EMP-BUDI", false, "EMP-BUDI")
	insertClient(t, s, "CLI-B", "EMP-BUDI", false, "EMP-BUDI", "EMP-CITRA")
	// CLI-C is released to Account.
	insertClient(t, s, "CLI-C", "EMP-BUDI", true, "EMP-BUDI")

	// Sales staff sees own clients.
	if !canSee(t, s, salesStaff("EMP-BUDI"), "CLI-A") {
		t.Errorf("owner should see own client")
	}
	// A different sales staff sees neither.
	if canSee(t, s, salesStaff("EMP-ANDI"), "CLI-A") {
		t.Errorf("other sales staff must NOT see another's client")
	}
	// An allocation member (not Primary) sees the client.
	if !canSee(t, s, salesStaff("EMP-CITRA"), "CLI-B") {
		t.Errorf("allocation member should see the client (read visibility)")
	}
	if canSee(t, s, salesStaff("EMP-CITRA"), "CLI-A") {
		t.Errorf("non-member sales staff must not see CLI-A")
	}
	// Account Staff (AM) sees neither pre-verification nor UNASSIGNED released
	// clients (M4 §6 Rule 3 assigned-granularity, paid off by W2-M6-C1).
	if canSee(t, s, accountStaff("EMP-AM"), "CLI-A") {
		t.Errorf("Account must NOT see pre-verification client")
	}
	if canSee(t, s, accountStaff("EMP-AM"), "CLI-C") {
		t.Errorf("Account Staff must NOT see a released client not assigned to them")
	}
	// Assign CLI-C to EMP-AM: now the assigned AM sees it, a different AM does not.
	assignAM(t, s, "CLI-C", "EMP-AM")
	if !canSee(t, s, accountStaff("EMP-AM"), "CLI-C") {
		t.Errorf("assigned AM should see their client")
	}
	if canSee(t, s, accountStaff("EMP-OTHERAM"), "CLI-C") {
		t.Errorf("a non-assigned AM must NOT see another AM's client")
	}
	// Account Lead sees every released client regardless of assignment.
	if !canSee(t, s, accountLead("EMP-ALEAD"), "CLI-C") {
		t.Errorf("Account Lead should see released client")
	}
	if canSee(t, s, accountLead("EMP-ALEAD"), "CLI-A") {
		t.Errorf("Account Lead must NOT see pre-verification client")
	}
	// Sales lead, OD, Director see everything.
	for _, a := range []permission.Actor{salesLead("EMP-DEWI"), odActor("EMP-OD"), directorActor("EMP-DIR")} {
		if !canSee(t, s, a, "CLI-A") {
			t.Errorf("%+v should see all clients", a.Role)
		}
	}
	// Execution-division staff have no list access at all.
	if _, err := s.List(context.Background(), execStaff("EMP-CREA")); !errors.Is(err, ErrForbidden) {
		t.Errorf("execution staff List err = %v, want ErrForbidden", err)
	}
}

func TestListRespectsVisibility(t *testing.T) {
	s := newService(t)
	insertClient(t, s, "CLI-A", "EMP-BUDI", false, "EMP-BUDI")
	insertClient(t, s, "CLI-C", "EMP-OTHER", true, "EMP-OTHER")
	assignAM(t, s, "CLI-C", "EMP-AM")

	// Sales staff Budi lists only his own.
	got, err := s.List(context.Background(), salesStaff("EMP-BUDI"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "CLI-A" {
		t.Errorf("Budi list = %v, want [CLI-A]", ids(got))
	}
	// Account staff lists only released clients ASSIGNED to them.
	got, err = s.List(context.Background(), accountStaff("EMP-AM"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "CLI-C" {
		t.Errorf("assigned AM list = %v, want [CLI-C]", ids(got))
	}
	// A different AM (nothing assigned) lists nothing.
	got, err = s.List(context.Background(), accountStaff("EMP-OTHERAM"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("unassigned AM list = %v, want []", ids(got))
	}
	// Account Lead lists all released ones regardless of assignment.
	got, err = s.List(context.Background(), accountLead("EMP-ALEAD"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "CLI-C" {
		t.Errorf("Account Lead list = %v, want [CLI-C]", ids(got))
	}
	// Director lists all.
	got, _ = s.List(context.Background(), directorActor("EMP-DIR"))
	if len(got) != 2 {
		t.Errorf("Director list = %v, want 2", ids(got))
	}
}

func ids(cs []Client) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.ID
	}
	return out
}
