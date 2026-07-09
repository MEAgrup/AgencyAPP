// Command seed loads the Alpha Digital worked-example fixture (idempotent).
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/meagrup/agencyapp/backend/internal/db"
	"github.com/meagrup/agencyapp/backend/internal/seed"
)

func main() {
	d, err := db.Open(db.DSN())
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer d.Close()
	if err := seed.Run(context.Background(), d, ""); err != nil {
		log.Fatalf("seed: %v", err)
	}
	fmt.Println("seed: OK")
}
