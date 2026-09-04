// Package db provides the MySQL connection and a minimal, self-contained
// migration runner (up AND down) driven by SQL files in backend/migrations.
package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// DefaultDSN is used when no DSN env var is set.
const DefaultDSN = "cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps?parseTime=true&multiStatements=true"

// DSN returns the configured DSN with a sensible default.
//
// Resolution order: CDPS_DSN, then DATABASE_URL, then MYSQL_URL (the last two
// are what Railway / other PaaS expose for a provisioned MySQL). Any value in
// the URL form ("mysql://user:pass@host:port/db") is normalized to the DSN the
// go-sql-driver/mysql driver expects ("user:pass@tcp(host:port)/db?...").
func DSN() string {
	for _, k := range []string{"CDPS_DSN", "DATABASE_URL", "MYSQL_URL"} {
		if v := os.Getenv(k); v != "" {
			return normalizeDSN(v)
		}
	}
	return DefaultDSN
}

// normalizeDSN converts a "mysql://" URL into a go-sql-driver DSN, ensuring the
// parseTime and multiStatements params CDPS relies on are present. Values that
// are already in driver DSN form are returned unchanged.
func normalizeDSN(v string) string {
	if !strings.HasPrefix(v, "mysql://") {
		return v
	}
	u, err := url.Parse(v)
	if err != nil {
		return v
	}
	host := u.Host // host[:port]
	if !strings.Contains(host, ":") {
		host += ":3306"
	}
	dbName := strings.TrimPrefix(u.Path, "/")

	q := u.Query()
	q.Set("parseTime", "true")
	q.Set("multiStatements", "true")

	var userInfo string
	if u.User != nil {
		if pw, ok := u.User.Password(); ok {
			userInfo = u.User.Username() + ":" + pw
		} else {
			userInfo = u.User.Username()
		}
		userInfo += "@"
	}
	return fmt.Sprintf("%stcp(%s)/%s?%s", userInfo, host, dbName, q.Encode())
}

// TestDSN returns the DSN pointed at the cdps_test database.
func TestDSN() string {
	if v := os.Getenv("CDPS_TEST_DSN"); v != "" {
		return v
	}
	return "cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true"
}

// Open opens (and pings) a MySQL connection for the given DSN.
func Open(dsn string) (*sql.DB, error) {
	d, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	d.SetConnMaxLifetime(3 * time.Minute)
	d.SetMaxOpenConns(20)
	d.SetMaxIdleConns(10)
	if err := d.Ping(); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return d, nil
}
