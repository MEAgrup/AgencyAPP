// Command migrate applies (up) or rolls back (down) CDPS schema migrations.
//
//	migrate up          apply all pending
//	migrate down        roll back the last migration
//	migrate down all    roll back everything
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/meagrup/agencyapp/backend/internal/db"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: migrate <up|down> [all|N]")
	}
	d, err := db.Open(db.DSN())
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer d.Close()
	dir := db.FindMigrationsDir()

	switch os.Args[1] {
	case "up":
		if err := db.MigrateUp(d, dir); err != nil {
			log.Fatalf("migrate up: %v", err)
		}
		fmt.Println("migrate up: OK")
	case "down":
		n := 1
		if len(os.Args) >= 3 && os.Args[2] == "all" {
			n = 0
		}
		if err := db.MigrateDown(d, dir, n); err != nil {
			log.Fatalf("migrate down: %v", err)
		}
		fmt.Println("migrate down: OK")
	default:
		log.Fatalf("unknown command %q", os.Args[1])
	}
}
