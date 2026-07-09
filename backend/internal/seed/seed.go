// Package seed loads the Alpha Digital worked-example fixture skeleton (S0-11).
// It is idempotent: running it repeatedly converges to the same state.
package seed

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/demo"
	"github.com/meagrup/agencyapp/backend/internal/hris"
)

// systemDirector is the synthetic actor used for seeding privileged rows.
var systemDirector = permission.Actor{EmployeeID: "SYSTEM", Role: permission.Role{Director: true}}

// FindEmployeesCSV locates backend/testdata/employees.csv relative to go.mod.
func FindEmployeesCSV() string {
	if v := os.Getenv("CDPS_SEED_CSV"); v != "" {
		return v
	}
	dir, err := os.Getwd()
	if err != nil {
		return "testdata/employees.csv"
	}
	for {
		cand := filepath.Join(dir, "testdata", "employees.csv")
		if _, err := os.Stat(cand); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
				return cand
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "testdata/employees.csv"
}

// roleMappings is the seed HRIS(divisi,jabatan) -> CDPS(division,level) table.
var roleMappings = []admin.RoleMapping{
	{Divisi: "Sales", Jabatan: "Sales Executive", Division: "Sales", Level: "staff"},
	{Divisi: "Sales", Jabatan: "Sales Head", Division: "Sales", Level: "lead"},
	{Divisi: "Account", Jabatan: "Account Manager", Division: "Account", Level: "staff"},
	{Divisi: "Account", Jabatan: "Account Lead", Division: "Account", Level: "lead"},
	{Divisi: "Creative", Jabatan: "Creative Designer", Division: "Creative", Level: "staff"},
	{Divisi: "Creative", Jabatan: "Creative Lead", Division: "Creative", Level: "lead"},
	{Divisi: "Ads", Jabatan: "Ads Specialist", Division: "Ads", Level: "staff"},
	{Divisi: "Ads", Jabatan: "Ads Lead", Division: "Ads", Level: "lead"},
	{Divisi: "KOL", Jabatan: "KOL Specialist", Division: "KOL", Level: "staff"},
	{Divisi: "KOL", Jabatan: "KOL Lead", Division: "KOL", Level: "lead"},
	{Divisi: "Finance", Jabatan: "Finance Staff", Division: "Finance", Level: "staff"},
	{Divisi: "Finance", Jabatan: "Finance Head", Division: "Finance", Level: "lead"},
}

var directors = []string{"EMP-0008", "EMP-0009", "EMP-0010"}

var masterServices = []admin.ServiceInput{
	{Name: "Ads Management", StandardPrice: "10000000.00", CommissionRule: "5% of standard price", Active: true, EffectiveFrom: "2026-01-01"},
	{Name: "KOL Management", StandardPrice: "7500000.00", CommissionRule: "4% of standard price", Active: true, EffectiveFrom: "2026-01-01"},
	{Name: "Live Stream Package", StandardPrice: "12000000.00", CommissionRule: "flat Rp 500.000", Active: true, EffectiveFrom: "2026-01-01"},
}

// Run applies the full seed. csvPath may be "" to auto-locate.
func Run(ctx context.Context, d *sql.DB, csvPath string) error {
	if csvPath == "" {
		csvPath = FindEmployeesCSV()
	}

	// 1) Employees (idempotent upsert via HRIS sync from CSV source).
	src := hris.NewCSVSource(csvPath)
	if _, err := hris.Sync(ctx, d, src, "SYSTEM", true); err != nil {
		return err
	}

	// 2) Role mappings (upsert => idempotent).
	for _, m := range roleMappings {
		if _, err := admin.UpsertRoleMapping(ctx, d, systemDirector, m); err != nil {
			return err
		}
	}

	// 3) Layered Director roles (upsert => idempotent).
	for _, id := range directors {
		if err := admin.SetLayeredRole(ctx, d, systemDirector, id, "director", true); err != nil {
			return err
		}
	}

	// 4) Master services (guarded => idempotent).
	var svcCount int
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM master_services`).Scan(&svcCount); err != nil {
		return err
	}
	if svcCount == 0 {
		for _, in := range masterServices {
			if _, err := admin.CreateService(ctx, d, systemDirector, in); err != nil {
				return err
			}
		}
	}

	// 5) One demo task owned by Budi (Sales staff) (guarded => idempotent).
	var taskCount int
	if err := d.QueryRowContext(ctx, `SELECT COUNT(*) FROM demo_tasks`).Scan(&taskCount); err != nil {
		return err
	}
	if taskCount == 0 {
		budi, err := auth.ResolveActor(ctx, d, "EMP-0001")
		if err != nil {
			return err
		}
		svc := &demo.Service{DB: d, Engine: statemachine.New(), Catalog: notification.NewCatalog()}
		if _, err := svc.Create(ctx, budi, "Contoh Brief — Konten Feed Alpha Digital", "Task demo Sprint 0 untuk Alpha Digital."); err != nil {
			return err
		}
	}
	return nil
}
