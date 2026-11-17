package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/markrai/wellspan/internal/httpapi"
	"github.com/markrai/wellspan/internal/store"
)

func main() {
	listen := flag.String("listen", ":8080", "HTTP listen address")
	database := flag.String("db", "/data/wellspan.sqlite", "persistent SQLite database path")
	staticDir := flag.String("static", "/app", "path to frontend files")
	flag.Parse()

	db, err := store.Open(*database)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	srv := &http.Server{
		Addr:              *listen,
		Handler:           httpapi.Handler(db, *staticDir),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	log.Printf("Wellspan listening on %s", *listen)
	log.Fatal(srv.ListenAndServe())
}
