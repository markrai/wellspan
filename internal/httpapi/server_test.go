package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/markrai/wellspan/internal/store"
)

const sampleBoard = `{"version":1,"foods":[{"id":"food-1","name":"Soy milk","nutrients":{"calories":80,"protein":7,"carbs":4,"fat":4,"satFat":0.5,"fiber":0,"sugars":1,"sodium":100,"cholesterol":0},"notes":""}],"meals":{"breakfast":["food-1"],"lunch":[],"dinner":[]}}`

func newServer(t *testing.T) (http.Handler, *store.Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "wellspan.sqlite")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return Handler(db, t.TempDir()), db, path
}

func request(handler http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	handler.ServeHTTP(rec, req)
	return rec
}

func TestBootstrapAndRevisionCAS(t *testing.T) {
	h, _, _ := newServer(t)
	empty := request(h, "GET", "/api/v1/state", "", nil)
	if empty.Code != 200 || !strings.Contains(empty.Body.String(), `"revision":0,"state":null`) {
		t.Fatalf("initial state: %d %s", empty.Code, empty.Body.String())
	}
	start := request(h, "POST", "/api/v1/bootstrap", sampleBoard, nil)
	if start.Code != 201 || start.Header().Get("ETag") != `"rev-1"` {
		t.Fatalf("bootstrap: %d %s", start.Code, start.Body.String())
	}
	retry := request(h, "POST", "/api/v1/bootstrap", sampleBoard, nil)
	if retry.Code != 201 {
		t.Fatalf("retry must be idempotent: %d", retry.Code)
	}
	changed := strings.Replace(sampleBoard, "Soy milk", "Unsweetened soy milk", 1)
	conflict := request(h, "POST", "/api/v1/bootstrap", changed, nil)
	if conflict.Code != 409 {
		t.Fatalf("second bootstrap must conflict: %d", conflict.Code)
	}
	missingTag := request(h, "PUT", "/api/v1/state", changed, nil)
	if missingTag.Code != 428 {
		t.Fatalf("unguarded update: %d", missingTag.Code)
	}
	updated := request(h, "PUT", "/api/v1/state", changed, map[string]string{"If-Match": `"rev-1"`})
	if updated.Code != 200 || updated.Header().Get("ETag") != `"rev-2"` {
		t.Fatalf("CAS update: %d %s", updated.Code, updated.Body.String())
	}
	stale := request(h, "PUT", "/api/v1/state", sampleBoard, map[string]string{"If-Match": `"rev-1"`})
	if stale.Code != 409 || !strings.Contains(stale.Body.String(), "Unsweetened soy milk") {
		t.Fatalf("stale client must receive current state: %d %s", stale.Code, stale.Body.String())
	}
}

func TestSQLiteSurvivesRestart(t *testing.T) {
	h, db, path := newServer(t)
	if code := request(h, "POST", "/api/v1/bootstrap", sampleBoard, nil).Code; code != 201 {
		t.Fatalf("bootstrap status %d", code)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got := request(Handler(reopened, t.TempDir()), "GET", "/api/v1/state", "", nil)
	var state struct {
		Revision int64           `json:"revision"`
		State    json.RawMessage `json:"state"`
	}
	if err := json.Unmarshal(got.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if state.Revision != 1 || !strings.Contains(string(state.State), "Soy milk") {
		t.Fatalf("state lost after restart: %s", got.Body.String())
	}
}

func TestOriginAndShapeProtection(t *testing.T) {
	h, _, _ := newServer(t)
	badOrigin := request(h, "POST", "/api/v1/bootstrap", sampleBoard, map[string]string{"Origin": "https://malicious.example"})
	if badOrigin.Code != 403 {
		t.Fatalf("cross-origin write: %d", badOrigin.Code)
	}
	badSite := request(h, "POST", "/api/v1/bootstrap", sampleBoard, map[string]string{"Sec-Fetch-Site": "cross-site"})
	if badSite.Code != 403 {
		t.Fatalf("cross-site write: %d", badSite.Code)
	}
	badData := request(h, "POST", "/api/v1/bootstrap", `{"version":1,"foods":[],"meals":{"breakfast":[],"lunch":[]}}`, nil)
	if badData.Code != 400 {
		t.Fatalf("invalid board: %d", badData.Code)
	}
	oversized := request(h, "POST", "/api/v1/bootstrap", strings.Repeat(" ", 2*1024*1024+1), nil)
	if oversized.Code != 413 {
		t.Fatalf("oversize body: %d", oversized.Code)
	}
	notFound := request(h, "GET", "/something-that-does-not-exist", "", nil)
	if notFound.Code != 404 {
		t.Fatalf("unexpected app-shell 200 for invalid path: %d", notFound.Code)
	}
}

func TestHealthRequiresDatabase(t *testing.T) {
	h, db, _ := newServer(t)
	healthy := request(h, "GET", "/health", "", nil)
	if healthy.Code != http.StatusOK {
		t.Fatalf("healthy database: %d", healthy.Code)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	unhealthy := request(h, "GET", "/health", "", nil)
	if unhealthy.Code != http.StatusInternalServerError {
		t.Fatalf("closed database must report unhealthy: %d", unhealthy.Code)
	}
}
