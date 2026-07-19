// Command cdps runs the CDPS API server.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/auth"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/hris"
	"github.com/meagrup/agencyapp/backend/internal/httpapi"
)

func main() {
	d, err := db.Open(db.DSN())
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer d.Close()

	// Ensure schema is current.
	if err := db.MigrateUp(d, db.FindMigrationsDir()); err != nil {
		log.Fatalf("migrate up: %v", err)
	}

	hrisURL := envOr("HRIS_BASE_URL", "http://127.0.0.1:8081")
	authn := auth.NewHRISAuthenticator(hrisURL)

	var src hris.EmployeeSource
	if token := os.Getenv("HRIS_SERVICE_TOKEN"); token != "" || os.Getenv("HRIS_HTTP_SYNC") == "1" {
		src = hris.NewHTTPSource(hrisURL, token)
	} else {
		src = hris.NewCSVSource(envOr("CDPS_SEED_CSV", "testdata/employees.csv"))
	}

	engine := statemachine.New()
	catalog := notification.NewCatalog()
	app := httpapi.New(d, engine, catalog, authn, src)

	// Railway (and most PaaS) inject the port to listen on via PORT. An explicit
	// CDPS_ADDR still wins for local/dev overrides.
	addr := envOr("CDPS_ADDR", ":8080")
	if port := os.Getenv("PORT"); port != "" && os.Getenv("CDPS_ADDR") == "" {
		addr = ":" + port
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           app.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("cdps API listening on %s (HRIS=%s)", addr, hrisURL)

	// Background full sync on boot (best-effort) so sessions/roles are fresh.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if res, err := hris.Sync(ctx, d, src, "SYSTEM", true); err != nil {
			log.Printf("initial sync failed (non-fatal): %v", err)
		} else {
			log.Printf("initial sync: synced=%d deactivated=%d flagged=%d", res.Synced, res.Deactivated, res.Flagged)
		}
	}()

	log.Fatal(srv.ListenAndServe())
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
