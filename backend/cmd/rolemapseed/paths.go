package main

import (
	"os"
	"path/filepath"
)

// findSeedFile walks up from the current working directory until it finds
// "seed/<name>" sitting alongside a go.mod — the same walk-up convention as
// db.FindMigrationsDir / mslseed.FindSeedCSV, so this works whether
// rolemapseed is launched from the repo root, backend/, or a subpackage's
// test cwd. envVar, if set, wins outright.
func findSeedFile(envVar, name, fallback string) string {
	if v := os.Getenv(envVar); v != "" {
		return v
	}
	dir, err := os.Getwd()
	if err != nil {
		return fallback
	}
	for {
		cand := filepath.Join(dir, "seed", name)
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
	return fallback
}

// FindRoleMappingsCSV locates backend/seed/role_mappings_riil.csv relative to
// the module root (env CDPS_ROLE_MAP_CSV wins).
func FindRoleMappingsCSV() string {
	return findSeedFile("CDPS_ROLE_MAP_CSV", "role_mappings_riil.csv", "seed/role_mappings_riil.csv")
}

// FindLayeredRolesCSV locates backend/seed/layered_roles_riil.csv relative to
// the module root (env CDPS_LAYERED_ROLE_CSV wins).
func FindLayeredRolesCSV() string {
	return findSeedFile("CDPS_LAYERED_ROLE_CSV", "layered_roles_riil.csv", "seed/layered_roles_riil.csv")
}
