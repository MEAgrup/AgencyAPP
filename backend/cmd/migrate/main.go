// migrate applies the SQL migrations in backend/migrations.
// Usage: migrate -dsn "user:pass@tcp(host:3306)/dbname" -dir up|down
package main

import (
	"errors"
	"flag"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	dsn := flag.String("dsn", "", "mysql dsn, e.g. cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev")
	dir := flag.String("dir", "up", "up or down")
	src := flag.String("src", "file://migrations", "migration source")
	flag.Parse()
	if *dsn == "" {
		log.Fatal("-dsn is required")
	}
	m, err := migrate.New(*src, "mysql://"+*dsn)
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
