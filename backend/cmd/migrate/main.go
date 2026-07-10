// migrate applies the SQL migrations in backend/migrations.
// Usage: migrate -dsn "user:pass@tcp(host:3306)/dbname" -dir up|down
// (the multiStatements DSN param is added automatically).
package main

import (
	"errors"
	"flag"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

func main() {
	dsn := flag.String("dsn", "", "mysql dsn, e.g. cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev (multiStatements added automatically)")
	dir := flag.String("dir", "up", "up or down")
	src := flag.String("src", "file://migrations", "migration source")
	flag.Parse()
	if *dsn == "" {
		log.Fatal("-dsn is required")
	}
	// multiStatements is required to run the multi-statement .sql files.
	migrateDSN := db.WithParams(*dsn, map[string]string{"multiStatements": "true"})
	m, err := migrate.New(*src, "mysql://"+migrateDSN)
	if err != nil {
		log.Fatal(err)
	}
	switch *dir {
	case "up":
		err = m.Up()
	case "down":
		err = m.Down()
	default:
		log.Fatalf("unknown -dir %q", *dir)
	}
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		log.Fatal(err)
	}
	log.Printf("migrate %s: done", *dir)
}
