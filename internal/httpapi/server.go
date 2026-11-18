package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/markrai/wellspan/internal/board"
	"github.com/markrai/wellspan/internal/store"
)

type response struct {
	Revision int64           `json:"revision"`
	State    json.RawMessage `json:"state"`
}

func Handler(database *store.Store, staticDir string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if _, err := database.Read(r.Context()); err != nil {
			serverError(w)
			return
		}
		writeJSON(w, http.StatusOK, []byte(`{"ok":true}`), 0)
	})
	mux.HandleFunc("GET /api/v1/state", func(w http.ResponseWriter, r *http.Request) {
		snap, err := database.Read(r.Context())
		if err != nil {
			serverError(w)
			return
		}
		sendSnapshot(w, http.StatusOK, snap)
	})
	mux.HandleFunc("POST /api/v1/bootstrap", func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(r) {
			errorJSON(w, http.StatusForbidden, "origin_not_allowed")
			return
		}
		body, ok := readBoard(w, r)
		if !ok {
			return
		}
		snap, accepted, err := database.Bootstrap(r.Context(), body)
		if err != nil {
			serverError(w)
			return
		}
		if !accepted {
			sendSnapshot(w, http.StatusConflict, snap)
			return
		}
		status := http.StatusOK
		if snap.Revision == 1 {
			status = http.StatusCreated
		}
		sendSnapshot(w, status, snap)
	})
	mux.HandleFunc("PUT /api/v1/state", func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(r) {
			errorJSON(w, http.StatusForbidden, "origin_not_allowed")
			return
		}
		tag := r.Header.Get("If-Match")
		if tag == "" {
			errorJSON(w, http.StatusPreconditionRequired, "if_match_required")
			return
		}
		prev, ok := parseRevision(tag)
		if !ok {
			errorJSON(w, http.StatusBadRequest, "invalid_revision")
			return
		}
		body, valid := readBoard(w, r)
		if !valid {
			return
		}
		snap, updated, err := database.Replace(r.Context(), prev, body)
		if err != nil {
			serverError(w)
			return
		}
		if !updated {
			sendSnapshot(w, http.StatusConflict, snap)
			return
		}
		sendSnapshot(w, http.StatusOK, snap)
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
	mux.HandleFunc("GET /sw.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(staticDir, "sw.js"))
	})
	mux.HandleFunc("GET /manifest.webmanifest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/manifest+json")
		http.ServeFile(w, r, filepath.Join(staticDir, "manifest.webmanifest"))
	})
	mux.Handle("GET /icons/", http.StripPrefix("/icons/", http.FileServer(http.Dir(filepath.Join(staticDir, "icons")))))
	mux.Handle("GET /probe/", http.StripPrefix("/probe/", http.FileServer(http.Dir(filepath.Join(staticDir, "probe")))))
	mux.Handle("GET /src/", http.StripPrefix("/src/", http.FileServer(http.Dir(filepath.Join(staticDir, "src")))))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

func readBoard(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	media := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if media != "application/json" {
		errorJSON(w, http.StatusUnsupportedMediaType, "json_required")
		return nil, false
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, board.MaximumBytes))
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			errorJSON(w, http.StatusRequestEntityTooLarge, "payload_too_large")
		} else {
			errorJSON(w, http.StatusBadRequest, "bad_body")
		}
		return nil, false
	}
	canonical, err := board.Decode(data)
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_board")
		return nil, false
	}
	return canonical, true
}

func sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.Opaque != "" || u.Host != r.Host || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	return u.Scheme == "https" || u.Scheme == "http"
}

func parseRevision(value string) (int64, bool) {
	if !strings.HasPrefix(value, `"rev-`) || !strings.HasSuffix(value, `"`) {
		return 0, false
	}
	n, err := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(value, `"rev-`), `"`), 10, 64)
	return n, err == nil && n > 0
}

func sendSnapshot(w http.ResponseWriter, status int, snap store.Snapshot) {
	state := json.RawMessage("null")
	if snap.Exists {
		state = snap.Body
		w.Header().Set("ETag", fmt.Sprintf(`"rev-%d"`, snap.Revision))
	}
	body, err := json.Marshal(response{Revision: snap.Revision, State: state})
	if err != nil {
		serverError(w)
		return
	}
	writeJSON(w, status, body, snap.Revision)
}

func writeJSON(w http.ResponseWriter, status int, body []byte, revision int64) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(body)
}

func errorJSON(w http.ResponseWriter, status int, code string) {
	body, _ := json.Marshal(map[string]string{"error": code})
	writeJSON(w, status, body, 0)
}

func serverError(w http.ResponseWriter) {
	errorJSON(w, http.StatusInternalServerError, "server_error")
}
