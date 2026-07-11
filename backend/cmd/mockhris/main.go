// Command mockhris is a dev-only stand-in for the existing HRIS. It implements
// the two contract endpoints (docs/HRIS_API_CONTRACT.md) from the seed CSV so
// local login and sync work end-to-end. All fixture passwords are rahasia123.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

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

	byEmail := map[string]hris.CSVRecord{}
	for _, r := range records {
		byEmail[strings.ToLower(r.Employee.Email)] = r
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

	mux.HandleFunc("POST /api/v1/auth/verify", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"valid": false, "reason": "bad_request"})
			return
		}
		rec, ok := byEmail[strings.ToLower(strings.TrimSpace(body.Email))]
		if !ok || rec.Password != body.Password {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"valid": false, "reason": "invalid_credentials"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"valid": true, "employee_id": rec.Employee.EmployeeID})
	})

	log.Printf("mockhris listening on %s (%d employees from %s)", addr, len(records), csvPath)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
