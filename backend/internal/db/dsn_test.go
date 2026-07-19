package db

import (
	"strings"
	"testing"
)

func TestNormalizeDSN(t *testing.T) {
	t.Run("mysql URL is converted to driver DSN with required params", func(t *testing.T) {
		got := normalizeDSN("mysql://root:s3cret@monorail.proxy.rlwy.net:34567/railway")
		// Order of query params is not guaranteed by url.Values.Encode, so assert
		// on the fixed prefix and the presence of each required param.
		if !strings.HasPrefix(got, "root:s3cret@tcp(monorail.proxy.rlwy.net:34567)/railway?") {
			t.Fatalf("unexpected prefix: %q", got)
		}
		for _, want := range []string{"parseTime=true", "multiStatements=true"} {
			if !strings.Contains(got, want) {
				t.Errorf("missing %q in %q", want, got)
			}
		}
	})

	t.Run("mysql URL without explicit port defaults to 3306", func(t *testing.T) {
		got := normalizeDSN("mysql://u:p@dbhost/appdb")
		if !strings.HasPrefix(got, "u:p@tcp(dbhost:3306)/appdb?") {
			t.Fatalf("expected default port, got %q", got)
		}
	})

	t.Run("driver-form DSN is returned unchanged", func(t *testing.T) {
		in := "cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps?parseTime=true&multiStatements=true"
		if got := normalizeDSN(in); got != in {
			t.Fatalf("driver DSN mutated: %q", got)
		}
	})
}
