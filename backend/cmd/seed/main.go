// seed applies all migrations, then loads the S0-11 fixture dataset (the
// Alpha Digital worked example, as far as Sprint 0 tables allow). Idempotent.
// Usage: seed -dsn "cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev?multiStatements=true"
package main

import (
	"context"
	"errors"
	"flag"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/seed"
)

func main() {
	dsn := flag.String("dsn", "", "mysql dsn, e.g. cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev?multiStatements=true")
	src := flag.String("src", "file://migrations", "migration source")
	flag.Parse()
	if *dsn == "" {
		log.Fatal("-dsn is required")
	}

	m, err := migrate.New(*src, "mysql://"+*dsn)
	if err != nil {
		log.Fatal(err)
	}
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		log.Fatal(err)
	}

	conn, err := db.Open(*dsn + "&parseTime=true")
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	if err := seed.Seed(context.Background(), conn); err != nil {
		log.Fatal(err)
	}
	log.Println("seed: done (idempotent — safe to re-run)")
}
