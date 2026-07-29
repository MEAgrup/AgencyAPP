package main

import (
	"os"
	"path/filepath"
)

// findSeedFile walks up from the current working directory looking for <name>
// in either canonical seed location, so this works whether rolemapseed is
// launched from the repo root, backend/, or a subpackage's test cwd:
//
//	<dir>/supabase/seed/<name>  — the canonical home since 2026-07-29 (the real
//	                              org data was moved out of backend/ ahead of
//	                              C-05; see supabase/seed/README.md)
//	<dir>/seed/<name>           — the legacy backend/seed/ location, still holding
//	                              msl_kalkulator.csv, guarded by a go.mod sibling
//	                              (the same walk-up convention as
//	                              db.FindMigrationsDir / mslseed.FindSeedCSV)
//
// supabase/seed/ is checked first: after the move it is the file that exists, and
// a stale backend/seed/ copy must never win over it. envVar, if set, wins outright.
func findSeedFile(envVar, name, fallback string) string {
	if v := os.Getenv(envVar); v != "" {
		return v
	}
	dir, err := os.Getwd()
	if err != nil {
		return fallback
	}
	isFile := func(p string) bool {
		st, err := os.Stat(p)
		return err == nil && !st.IsDir()
	}
	for {
		if cand := filepath.Join(dir, "supabase", "seed", name); isFile(cand) {
			return cand
		}
		if cand := filepath.Join(dir, "seed", name); isFile(cand) {
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

// FindRoleMappingsCSV locates supabase/seed/role_mappings_riil.csv relative to
// the repo root (env CDPS_ROLE_MAP_CSV wins).
func FindRoleMappingsCSV() string {
	return findSeedFile("CDPS_ROLE_MAP_CSV", "role_mappings_riil.csv", "supabase/seed/role_mappings_riil.csv")
}

// FindLayeredRolesCSV locates supabase/seed/layered_roles_riil.csv relative to
// the repo root (env CDPS_LAYERED_ROLE_CSV wins).
func FindLayeredRolesCSV() string {
	return findSeedFile("CDPS_LAYERED_ROLE_CSV", "layered_roles_riil.csv", "supabase/seed/layered_roles_riil.csv")
}
