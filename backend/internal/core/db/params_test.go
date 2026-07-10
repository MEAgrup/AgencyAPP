package db

import (
	"strings"
	"testing"
)

// parseParams splits a DSN's query portion into a map for order-independent
// assertions (WithParams appends new keys in map-iteration order).
func parseParams(t *testing.T, dsn string) (base string, params map[string]string) {
	t.Helper()
	params = map[string]string{}
	q := strings.IndexByte(dsn, '?')
	if q < 0 {
		return dsn, params
	}
	base = dsn[:q]
	for _, pair := range strings.Split(dsn[q+1:], "&") {
		if pair == "" {
			continue
		}
		k, v := pair, ""
		if eq := strings.IndexByte(pair, '='); eq >= 0 {
			k, v = pair[:eq], pair[eq+1:]
		}
		if _, dup := params[k]; dup {
			t.Fatalf("duplicate key %q in result %q", k, dsn)
		}
		params[k] = v
	}
	return base, params
}

func TestWithParams_BareDSN(t *testing.T) {
	const dsn = "cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev"
	got := WithParams(dsn, map[string]string{"multiStatements": "true"})
	base, params := parseParams(t, got)
	if base != dsn {
		t.Fatalf("base = %q, want %q", base, dsn)
	}
	if params["multiStatements"] != "true" {
		t.Fatalf("multiStatements = %q, want true (%q)", params["multiStatements"], got)
	}
}

func TestWithParams_ExistingQueryPreserved(t *testing.T) {
	const dsn = "cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev?parseTime=true"
	got := WithParams(dsn, map[string]string{"multiStatements": "true"})
	base, params := parseParams(t, got)
	if base != "cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev" {
		t.Fatalf("base = %q", base)
	}
	if params["parseTime"] != "true" {
		t.Fatalf("existing parseTime dropped: %q", got)
	}
	if params["multiStatements"] != "true" {
		t.Fatalf("multiStatements not added: %q", got)
	}
}

func TestWithParams_OverridesExisting(t *testing.T) {
	const dsn = "cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev?parseTime=false&loc=UTC"
	got := WithParams(dsn, map[string]string{"parseTime": "true"})
	_, params := parseParams(t, got)
	if params["parseTime"] != "true" {
		t.Fatalf("parseTime not overridden: %q", got)
	}
	if params["loc"] != "UTC" {
		t.Fatalf("unrelated param loc lost: %q", got)
	}
	// Overriding must not duplicate the key.
	if strings.Count(got, "parseTime=") != 1 {
		t.Fatalf("parseTime appears more than once: %q", got)
	}
}

func TestWithParams_NoParamsUnchanged(t *testing.T) {
	const dsn = "cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev?parseTime=true"
	if got := WithParams(dsn, nil); got != dsn {
		t.Fatalf("WithParams with nil params changed DSN: %q", got)
	}
}
