// Command mockhris is a dev-only stand-in for the existing HRIS. It serves the
// employee-sync endpoint (GET /api/v1/employees) from the seed CSV. As of the
// 2026-07-19 auth decision the HRIS is a data source only — authentication is
// owned by CDPS (local bcrypt passwords), so no auth/verify endpoint exists.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/meagrup/agencyapp/backend/internal/hris"
	"github.com/meagrup/agencyapp/backend/internal/seed"
)

func main() {
	addr := os.Getenv("MOCKHRIS_ADDR")
	if addr == "" {
		addr = ":8081"
	}
	csvPath := os.Getenv("CDPS_SEED_CSV")
	if csvPath == "" {
		csvPath = seed.FindEmployeesCSV()
	}

	f, err := os.Open(csvPath)
	if err != nil {
		log.Fatalf("open csv %s: %v", csvPath, err)
	}
	records, err := hris.ParseEmployeeCSV(f)
	f.Close()
	if err != nil {
		log.Fatalf("parse csv: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/v1/employees", func(w http.ResponseWriter, r *http.Request) {
		emps := make([]hris.Employee, 0, len(records))
		for _, rec := range records {
			emps = append(emps, rec.Employee)
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page <= 0 {
			page = 1
		}
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		if pageSize <= 0 {
			pageSize = 100
		}
		start := (page - 1) * pageSize
		if start > len(emps) {
			start = len(emps)
		}
		end := start + pageSize
		if end > len(emps) {
			end = len(emps)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"data": emps[start:end], "page": page, "page_size": pageSize, "total": len(emps),
		})
	})

	log.Printf("mockhris listening on %s (%d employees from %s)", addr, len(records), csvPath)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
