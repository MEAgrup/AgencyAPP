// Package testdb gives tests an isolated MySQL database with all migrations
// applied. Each call creates cdps_test_<pkg>_<rand>, migrates it up, and
// drops it on cleanup, so packages can run their DB tests concurrently.
// Tests skip when CDPS_TEST_MYSQL_DSN (or the local default) is unreachable.
package testdb

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	_ "github.com/go-sql-driver/mysql"
)

const defaultDSN = "cdps:cdps@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true"

// New returns a *sql.DB bound to a fresh, fully-migrated database.
func New(t *testing.T) *sql.DB {
	t.Helper()

	dsn := os.Getenv("CDPS_TEST_MYSQL_DSN")
	if dsn == "" {
		dsn = defaultDSN
	}
	admin, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Skipf("mysql unavailable: %v", err)
	}
	if err := admin.Ping(); err != nil {
		t.Skipf("mysql unreachable, skipping DB test: %v", err)
	}

	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("cdps_test_%s_%s", sanitize(t.Name()), hex.EncodeToString(suffix[:]))
	if _, err := admin.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatalf("create test db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec("DROP DATABASE IF EXISTS `" + name + "`")
		_ = admin.Close()
	})

	testDSN := replaceDBName(dsn, name)
	m, err := migrate.New("file://"+migrationsDir(t), "mysql://"+testDSN)
	if err != nil {
		t.Fatalf("init migrate: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate up: %v", err)
	}
	srcErr, dbErr := m.Close()
	if srcErr != nil || dbErr != nil {
		t.Fatalf("close migrate: %v %v", srcErr, dbErr)
	}

	conn, err := sql.Open("mysql", testDSN)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func sanitize(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	name := b.String()
	if len(name) > 24 {
		name = name[:24]
	}
	return name
}

func replaceDBName(dsn, name string) string {
	slash := strings.LastIndex(dsn, "/")
	rest := dsn[slash+1:]
	if q := strings.Index(rest, "?"); q >= 0 {
		return dsn[:slash+1] + name + rest[q:]
	}
	return dsn[:slash+1] + name
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate migrations dir")
	}
	// this file: backend/internal/core/testdb/testdb.go
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations")
}
