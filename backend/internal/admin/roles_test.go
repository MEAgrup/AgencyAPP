package admin_test

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/admin"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var director = permission.Actor{EmployeeID: "EMP-0001", Role: permission.Role{Director: true}}

func TestUpsertRoleMapping_LowercaseCanonicalized(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	if _, err := admin.UpsertRoleMapping(ctx, d, director, admin.RoleMapping{
		Divisi: "Marketing", Jabatan: "Growth Marketer", Division: "marketing", Level: "staff",
	}); err != nil {
		t.Fatal(err)
	}

	var got string
	if err := d.QueryRowContext(ctx,
		`SELECT division FROM role_mappings WHERE divisi=? AND jabatan=?`,
		"Marketing", "Growth Marketer").Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "Marketing" {
		t.Fatalf("stored division=%q want %q", got, "Marketing")
	}
}

func TestUpsertRoleMapping_LiveStreamVariants(t *testing.T) {
	d := testutil.DB(t)
	ctx := context.Background()

	for _, tc := range []struct {
		jabatan string
		input   string
	}{
		{"Live Host A", "livestream"},
		{"Live Host B", "live stream"},
		{"Live Host C", "LIVE STREAM"},
	} {
		testutil.Clean(t, d)
		if _, err := admin.UpsertRoleMapping(ctx, d, director, admin.RoleMapping{
			Divisi: "Live Stream", Jabatan: tc.jabatan, Division: tc.input, Level: "staff",
		}); err != nil {
			t.Fatalf("input %q: %v", tc.input, err)
		}
		var got string
		if err := d.QueryRowContext(ctx,
			`SELECT division FROM role_mappings WHERE divisi=? AND jabatan=?`,
			"Live Stream", tc.jabatan).Scan(&got); err != nil {
			t.Fatalf("input %q: %v", tc.input, err)
		}
		if got != "Live Stream" {
			t.Fatalf("input %q stored division=%q want %q", tc.input, got, "Live Stream")
		}
	}
}

func TestUpsertRoleMapping_UnknownDivisionRejectedNoRow(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	_, err := admin.UpsertRoleMapping(ctx, d, director, admin.RoleMapping{
		Divisi: "Growth", Jabatan: "Hacker", Division: "growth", Level: "staff",
	})
	if !errors.Is(err, admin.ErrBadDivision) {
		t.Fatalf("want ErrBadDivision, got %v", err)
	}
	var n int
	if err := d.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM role_mappings WHERE divisi=? AND jabatan=?`,
		"Growth", "Hacker").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("rejected mapping wrote %d rows, want 0", n)
	}
}

func TestUpsertRoleMapping_CanonicalUnchanged(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	if _, err := admin.UpsertRoleMapping(ctx, d, director, admin.RoleMapping{
		Divisi: "Account", Jabatan: "Account Manager", Division: "Account", Level: "lead",
	}); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := d.QueryRowContext(ctx,
		`SELECT division FROM role_mappings WHERE divisi=? AND jabatan=?`,
		"Account", "Account Manager").Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "Account" {
		t.Fatalf("stored division=%q want %q", got, "Account")
	}
}

func TestUpsertRoleMapping_BadLevelRegression(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	_, err := admin.UpsertRoleMapping(ctx, d, director, admin.RoleMapping{
		Divisi: "Sales", Jabatan: "Sales Executive", Division: "Sales", Level: "boss",
	})
	if !errors.Is(err, admin.ErrBadLevel) {
		t.Fatalf("want ErrBadLevel, got %v", err)
	}
}
