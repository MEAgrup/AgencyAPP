package db

import (
	"os"
	"path/filepath"
)

// FindMigrationsDir walks up from the current working directory looking for a
// "migrations" directory that sits next to go.mod. Works from any package's
// test cwd and from cmd binaries launched at the module root.
func FindMigrationsDir() string {
	if v := os.Getenv("CDPS_MIGRATIONS_DIR"); v != "" {
		return v
	}
	dir, err := os.Getwd()
	if err != nil {
		return "migrations"
	}
	for {
		cand := filepath.Join(dir, "migrations")
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
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
	return "migrations"
}
