package main

import (
	"os"
	"path/filepath"
)

// FindSeedCSV locates backend/seed/msl_kalkulator.csv relative to the module
// root, the same way db.FindMigrationsDir locates backend/migrations: walk up
// from the current working directory until a "seed/msl_kalkulator.csv" is
// found sitting alongside a go.mod. Works whether mslseed is launched from
// the repo root, backend/, or a subpackage's test cwd.
func FindSeedCSV() string {
	if v := os.Getenv("CDPS_MSL_SEED_CSV"); v != "" {
		return v
	}
	dir, err := os.Getwd()
	if err != nil {
		return "seed/msl_kalkulator.csv"
	}
	for {
		cand := filepath.Join(dir, "seed", "msl_kalkulator.csv")
		if st, err := os.Stat(cand); err == nil && !st.IsDir() {
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
	return "seed/msl_kalkulator.csv"
}
