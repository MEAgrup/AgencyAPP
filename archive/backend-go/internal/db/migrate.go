package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Migration is one versioned schema change with up and down SQL.
type Migration struct {
	Version string
	Name    string
	Up      string
	Down    string
}

// LoadMigrations reads *.up.sql / *.down.sql pairs from dir.
// File naming: NNNN_name.up.sql and NNNN_name.down.sql.
func LoadMigrations(dir string) ([]Migration, error) {
	ups, err := filepath.Glob(filepath.Join(dir, "*.up.sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(ups)
	var out []Migration
	for _, up := range ups {
		base := filepath.Base(up)
		key := strings.TrimSuffix(base, ".up.sql")
		parts := strings.SplitN(key, "_", 2)
		version := parts[0]
		name := ""
		if len(parts) > 1 {
			name = parts[1]
		}
		upSQL, err := os.ReadFile(up)
		if err != nil {
			return nil, err
		}
		downPath := filepath.Join(dir, key+".down.sql")
		downSQL, err := os.ReadFile(downPath)
		if err != nil {
			return nil, fmt.Errorf("missing down migration for %s: %w", base, err)
		}
		out = append(out, Migration{Version: version, Name: name, Up: string(upSQL), Down: string(downSQL)})
	}
	return out, nil
}

func ensureMigrationsTable(d *sql.DB) error {
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version VARCHAR(32) NOT NULL PRIMARY KEY,
		name VARCHAR(191) NOT NULL,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

func appliedVersions(d *sql.DB) (map[string]bool, error) {
	rows, err := d.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]bool{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		m[v] = true
	}
	return m, rows.Err()
}

// MigrateUp applies all pending migrations in order.
func MigrateUp(d *sql.DB, dir string) error {
	if err := ensureMigrationsTable(d); err != nil {
		return err
	}
	migs, err := LoadMigrations(dir)
	if err != nil {
		return err
	}
	applied, err := appliedVersions(d)
	if err != nil {
		return err
	}
	for _, m := range migs {
		if applied[m.Version] {
			continue
		}
		if _, err := d.Exec(m.Up); err != nil {
			return fmt.Errorf("apply up %s_%s: %w", m.Version, m.Name, err)
		}
		if _, err := d.Exec(`INSERT INTO schema_migrations (version, name) VALUES (?, ?)`, m.Version, m.Name); err != nil {
			return fmt.Errorf("record %s: %w", m.Version, err)
		}
	}
	return nil
}

// MigrateDown rolls back the last n applied migrations (n<=0 means all).
func MigrateDown(d *sql.DB, dir string, n int) error {
	if err := ensureMigrationsTable(d); err != nil {
		return err
	}
	migs, err := LoadMigrations(dir)
	if err != nil {
		return err
	}
	applied, err := appliedVersions(d)
	if err != nil {
		return err
	}
	// reverse order
	count := 0
	for i := len(migs) - 1; i >= 0; i-- {
		m := migs[i]
		if !applied[m.Version] {
			continue
		}
		if n > 0 && count >= n {
			break
		}
		if _, err := d.Exec(m.Down); err != nil {
			return fmt.Errorf("apply down %s_%s: %w", m.Version, m.Name, err)
		}
		if _, err := d.Exec(`DELETE FROM schema_migrations WHERE version = ?`, m.Version); err != nil {
			return fmt.Errorf("unrecord %s: %w", m.Version, err)
		}
		count++
	}
	return nil
}
