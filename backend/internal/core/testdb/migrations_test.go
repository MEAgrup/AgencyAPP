package testdb

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	_ "github.com/go-sql-driver/mysql"
)

// TestMigrationsUpDownUp exercises every .down.sql: it migrates a fresh,
// isolated database all the way Up, then all the way Down, then Up again.
// Without this, down-migrations are dead code that CI never runs. Skips when
// MySQL is unreachable, exactly like New.
func TestMigrationsUpDownUp(t *testing.T) {
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
	t.Cleanup(func() { _, _ = m.Close() })

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate up: %v", err)
	}
	// Down all the way — runs every .down.sql.
	if err := m.Down(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate down: %v", err)
	}
	// And back Up, proving the schema rebuilds cleanly after a full teardown.
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate up (after down): %v", err)
	}
}
