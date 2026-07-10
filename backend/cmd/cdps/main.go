// cdps is the CDPS modular-monolith server. Sprint 0: skeleton only; module
// routers mount here as waves land.
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	addr := os.Getenv("CDPS_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	log.Printf("cdps listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
