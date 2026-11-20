package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixtureLoboSnapshot(t *testing.T, devices []discoveredLobo, when time.Time) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "devices.json")
	body, err := json.Marshal(loboSnapshot{GeneratedAt: when, Devices: devices})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoboDiscoveryFreshBoundedAndExpiry(t *testing.T) {
	now := time.Now().UTC()
	device := discoveredLobo{
		ID: "LOBO-8207D3", Host: "pixel.local", Address: "192.168.1.200",
		Port: 7869, Proto: "1", Path: "/v1",
	}
	path := fixtureLoboSnapshot(t, []discoveredLobo{device}, now)
	reply := readLoboDiscovery(path, now)
	if reply.Status != "available" || len(reply.Devices) != 1 || reply.Devices[0] != device {
		t.Fatalf("fresh discovery: %+v", reply)
	}
	if got := readLoboDiscovery(path, now.Add(time.Minute)); got.Status != "unavailable" || len(got.Devices) != 0 {
		t.Fatalf("stale data leaked: %+v", got)
	}
	if got := readLoboDiscovery(path, now.Add(-time.Minute)); got.Status != "unavailable" {
		t.Fatalf("future snapshot accepted: %+v", got)
	}
	if got := readLoboDiscovery(path+".not-found", now); got.Status != "unavailable" {
		t.Fatalf("missing snapshot accepted: %+v", got)
	}
}

func TestLoboDiscoveryRejectsUnsafeDevices(t *testing.T) {
	now := time.Now().UTC()
	base := discoveredLobo{
		ID: "LOBO-8207D3", Host: "pixel.local", Address: "192.168.1.200",
		Port: 7869, Proto: "1", Path: "/v1",
	}
	cases := map[string]func(*discoveredLobo){
		"public": func(d *discoveredLobo) { d.Address = "8.8.8.8" },
		"loopback": func(d *discoveredLobo) { d.Address = "127.0.0.1" },
		"link-local": func(d *discoveredLobo) { d.Address = "169.254.1.3" },
		"not-lobo": func(d *discoveredLobo) { d.ID = "SPOOF-8207D3" },
		"bad-port": func(d *discoveredLobo) { d.Port = 65536 },
		"bad-host": func(d *discoveredLobo) { d.Host = "host.attacker.example" },
		"wrong-proto": func(d *discoveredLobo) { d.Proto = "2" },
		"wrong-path": func(d *discoveredLobo) { d.Path = "/admin" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			device := base
			mutate(&device)
			path := fixtureLoboSnapshot(t, []discoveredLobo{device}, now)
			if got := readLoboDiscovery(path, now); got.Status != "unavailable" || len(got.Devices) != 0 {
				t.Fatalf("invalid device accepted: %+v", got)
			}
		})
	}
	path := fixtureLoboSnapshot(t, []discoveredLobo{base, base}, now)
	if got := readLoboDiscovery(path, now); got.Status != "unavailable" {
		t.Fatalf("duplicate id accepted: %+v", got)
	}
}

func TestLoboDiscoveryMalformedSnapshotFailsClosed(t *testing.T) {
	now := time.Now().UTC()
	path := filepath.Join(t.TempDir(), "devices.json")
	for _, value := range []string{
		`{"generatedAt":"bogus","devices":[]}`,
		`{"generatedAt":"2026-11-20T20:00:00Z","devices":[],"extra":true}`,
		`{"generatedAt":"bogus","devices":[]}` + strings.Repeat(" ", 20000),
		`[]`,
	} {
		if err := os.WriteFile(path, []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
		if got := readLoboDiscovery(path, now); got.Status != "unavailable" {
			t.Fatalf("malformed snapshot accepted: %q", value[:min(120,len(value))])
		}
	}
}

func TestLoboDiscoveryEndpointReturnsNoStoreAndNoMutations(t *testing.T) {
	now := time.Now().UTC()
	device := discoveredLobo{
		ID: "LOBO-8207D3", Host: "pixel.local", Address: "192.168.1.200",
		Port: 7869, Proto: "1", Path: "/v1",
	}
	path := fixtureLoboSnapshot(t, []discoveredLobo{device}, now)
	t.Setenv("WELLSPAN_LOBO_DISCOVERY_FILE", path)
	h, _, _ := newServer(t)
	received := request(h, "GET", "/api/v1/lobo/devices", "", nil)
	if received.Code != 200 || received.Header().Get("Cache-Control") != "no-store" ||
		!strings.Contains(received.Body.String(), "LOBO-8207D3") {
		t.Fatalf("discovery: %d %s", received.Code, received.Body.String())
	}
	if got := request(h, "POST", "/api/v1/lobo/devices", "{}", nil); got.Code != 405 {
		t.Fatalf("discovery must be GET-only: %d", got.Code)
	}
	if got := request(h, "GET", "/api/v1/state", "", nil); got.Code != 200 {
		t.Fatalf("discovery impacted board: %d", got.Code)
	}
}
