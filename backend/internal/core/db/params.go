package db

import "strings"

// WithParams returns dsn with the given query parameters appended or, where a
// key is already present, overridden. It performs plain string handling of a
// go-sql-driver DSN (user:pass@tcp(host:port)/dbname?a=b&c=d) — deliberately
// NOT url.Parse, because a go-sql-driver DSN is not a URL (the address form
// and unescaped credentials are not URL-legal). Keys with no value in dsn are
// treated as present and overridden. Parameter order is not significant to the
// driver, so appended params are simply added in map-iteration order.
func WithParams(dsn string, params map[string]string) string {
	if len(params) == 0 {
		return dsn
	}

	base := dsn
	existing := map[string]string{}
	var order []string
	if q := strings.IndexByte(dsn, '?'); q >= 0 {
		base = dsn[:q]
		for _, pair := range strings.Split(dsn[q+1:], "&") {
			if pair == "" {
				continue
			}
			key := pair
			val := ""
			if eq := strings.IndexByte(pair, '='); eq >= 0 {
				key = pair[:eq]
				val = pair[eq+1:]
			}
			if _, seen := existing[key]; !seen {
				order = append(order, key)
			}
			existing[key] = val
		}
	}

	// Override / add the requested params.
	for k, v := range params {
		if _, seen := existing[k]; !seen {
			order = append(order, k)
		}
		existing[k] = v
	}

	var b strings.Builder
	b.WriteString(base)
	for i, k := range order {
		if i == 0 {
			b.WriteByte('?')
		} else {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(existing[k])
	}
	return b.String()
}
