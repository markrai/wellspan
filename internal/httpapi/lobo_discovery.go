package httpapi

import (
	"encoding/json"
	"io"
	"net"
	"os"
	"regexp"
	"strings"
	"time"
)

const discoverySnapshotPath = "/discovery/devices.json"

var loboNamePattern = regexp.MustCompile(`^LOBO-[0-9A-F]{6}( \([2-9][0-9]*\))?$`)
var lanRanges = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}

type discoveredLobo struct {
	ID      string `json:"id"`
	Host    string `json:"host"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	Proto   string `json:"proto"`
	Path    string `json:"path"`
}

type loboSnapshot struct {
	GeneratedAt time.Time        `json:"generatedAt"`
	Devices     []discoveredLobo `json:"devices"`
}

type loboDiscoveryResponse struct {
	Status  string           `json:"status"`
	Devices []discoveredLobo `json:"devices"`
}

func privateLANAddress(value string) bool {
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() == nil || ip.String() != value {
		return false
	}
	for _, cidr := range lanRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func validDiscoveredLobo(device discoveredLobo) bool {
	if !loboNamePattern.MatchString(device.ID) ||
		device.Proto != "1" || device.Path != "/v1" ||
		device.Port < 1 || device.Port > 65535 ||
		!privateLANAddress(device.Address) ||
		len(device.Host) == 0 || len(device.Host) > 253 ||
		!strings.HasSuffix(device.Host, ".local") {
		return false
	}
	for _, character := range device.Host {
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '.' && character != '-' {
			return false
		}
	}
	return true
}

func readLoboDiscovery(path string, now time.Time) loboDiscoveryResponse {
	unavailable := loboDiscoveryResponse{Status: "unavailable", Devices: []discoveredLobo{}}
	file, err := os.Open(path)
	if err != nil {
		return unavailable
	}
	defer file.Close()
	var snapshot loboSnapshot
	decoder := json.NewDecoder(io.LimitReader(file, 16385))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return unavailable
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return unavailable
	}
	age := now.Sub(snapshot.GeneratedAt)
	if snapshot.GeneratedAt.IsZero() || age > 45*time.Second || age < -5*time.Second ||
		snapshot.Devices == nil || len(snapshot.Devices) > 16 {
		return unavailable
	}
	result := loboDiscoveryResponse{Status: "available", Devices: make([]discoveredLobo, 0, len(snapshot.Devices))}
	seen := make(map[string]bool)
	for _, device := range snapshot.Devices {
		if !validDiscoveredLobo(device) || seen[device.ID] {
			return unavailable
		}
		seen[device.ID] = true
		result.Devices = append(result.Devices, device)
	}
	return result
}

func loboDiscoveryPath() string {
	if path := os.Getenv("WELLSPAN_LOBO_DISCOVERY_FILE"); path != "" {
		return path
	}
	return discoverySnapshotPath
}

func discoveryJSON(path string, now time.Time) []byte {
	reply := readLoboDiscovery(path, now)
	body, err := json.Marshal(reply)
	if err != nil {
		return []byte(`{"status":"unavailable","devices":[]}`)
	}
	return body
}
