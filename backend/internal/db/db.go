// Package db provides the MySQL connection and a minimal, self-contained
// migration runner (up AND down) driven by SQL files in backend/migrations.
package db

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// DefaultDSN is used when CDPS_DSN is unset.
const DefaultDSN = "cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps?parseTime=true&multiStatements=true"

// DSN returns the configured DSN (env CDPS_DSN wins) with a sensible default.
func DSN() string {
	if v := os.Getenv("CDPS_DSN"); v != "" {
		return v
	}
	return DefaultDSN
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
