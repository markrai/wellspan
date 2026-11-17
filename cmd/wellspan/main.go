package main

import (
	"flag"
	"io"
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
	healthcheck := flag.Bool("healthcheck", false, "probe local HTTP health endpoint")
	flag.Parse()

	if *healthcheck {
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get("http://127.0.0.1:8080/health")
		if err != nil {
			log.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			log.Fatalf("healthcheck status: %d", resp.StatusCode)
		}
		if _, err := io.Copy(io.Discard, resp.Body); err != nil {
			log.Fatal(err)
		}
		return
	}

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
