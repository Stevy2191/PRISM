package inventory

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func loadRaw(t *testing.T, name string) Raw {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var r Raw
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestWindows11Fixture(t *testing.T) {
	inv := Assemble(loadRaw(t, "windows11-raw.json"))
	if inv.Hostname != "RFC-FD-01" || inv.Make != "Dell Inc." || inv.Model != "OptiPlex 7010" || inv.SerialNumber != "7XK4Q93" || inv.Firmware != "1.18.0" || inv.Domain != "RIVERSIDE" {
		t.Fatalf("identity: %+v", inv)
	}
	// Installed memory (the modules), not what Windows can see.
	if inv.MemoryBytes != 17179869184 {
		t.Fatalf("memory %d", inv.MemoryBytes)
	}
	if inv.CPU != (CPU{Model: "13th Gen Intel(R) Core(TM) i5-13500", Cores: 14}) {
		t.Fatalf("cpu %+v", inv.CPU)
	}
	// What PRISM shows: "Windows 11 Pro" and "24H2 (26100.2314)".
	if inv.OS != (OS{Name: "Microsoft Windows 11 Pro", Edition: "Windows 11 Pro", Version: "24H2", Build: "26100.2314"}) {
		t.Fatalf("os %+v", inv.OS)
	}
	if inv.LastBootAt != "2026-11-02T13:41:00Z" {
		t.Fatalf("last boot %s", inv.LastBootAt)
	}
	// Local and removable drives only (no network share); the USB backup
	// drive is marked so PRISM leaves it out of the storage figure.
	wantDisks := []Disk{
		{Name: "C:", Label: "Windows", Kind: "fixed", SizeBytes: 511101108224, FreeBytes: 227633270784},
		{Name: "D:", Label: "Backup", Kind: "usb", SizeBytes: 1000202039296, FreeBytes: 54760833024},
		{Name: "E:", Kind: "removable", SizeBytes: 31914983424, FreeBytes: 30000000000},
	}
	if !reflect.DeepEqual(inv.Disks, wantDisks) {
		t.Fatalf("disks %+v", inv.Disks)
	}
	// Up adapters with a real MAC; IPv4 only, no link-local; the primary is
	// the one with the default route's address.
	wantAdapters := []Adapter{
		{Name: "Ethernet", IPv4: []string{"10.20.1.45"}, MAC: "B0:7B:25:3E:91:0C", Primary: true},
		{Name: "Wi-Fi", IPv4: []string{}, MAC: "5C:E4:2A:10:7F:A3"},
	}
	if !reflect.DeepEqual(inv.Adapters, wantAdapters) {
		t.Fatalf("adapters %+v", inv.Adapters)
	}
	if inv.SignedInUser == nil || inv.SignedInUser.UPN != "maria.chen@riversideclinic.org" {
		t.Fatalf("user %+v", inv.SignedInUser)
	}
}

func TestSoftwareSkipsUpdatesSystemComponentsAndDuplicates(t *testing.T) {
	inv := Assemble(loadRaw(t, "windows11-raw.json"))
	var names []string
	for _, s := range inv.Software {
		names = append(names, s.Name)
	}
	want := []string{"7-Zip 24.08 (x64)", "Adobe Acrobat Reader (64-bit)", "Google Chrome", "Microsoft 365 Apps for business - en-us"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("software %v, want %v", names, want)
	}
	byName := map[string]Software{}
	for _, s := range inv.Software {
		byName[s.Name] = s
	}
	if byName["Google Chrome"].InstallDate != "2026-10-31" || byName["Adobe Acrobat Reader (64-bit)"].InstallDate != "2026-09-09" || byName["7-Zip 24.08 (x64)"].InstallDate != "" {
		t.Fatalf("install dates %+v", inv.Software)
	}
}

func TestPlaceholderHardwareValuesAreDropped(t *testing.T) {
	inv := Assemble(Raw{Hostname: "PC", Manufacturer: "System manufacturer", Model: "To Be Filled By O.E.M.", BIOSSerial: "Default string", TotalVisible: 8 << 30})
	if inv.Make != "" || inv.Model != "" || inv.SerialNumber != "" {
		t.Fatalf("placeholders kept: %+v", inv)
	}
	if inv.MemoryBytes != 8<<30 {
		t.Fatalf("memory fallback %d", inv.MemoryBytes)
	}
}

// The payload as JSON has the shape PRISM's parseInventory reads (Task 4):
// these keys, empty lists rather than null.
func TestPayloadShape(t *testing.T) {
	b, _ := json.Marshal(Assemble(loadRaw(t, "windows11-raw.json")))
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"hostname", "make", "model", "serialNumber", "firmware", "domain", "memoryBytes", "cpu", "os", "lastBootAt", "disks", "adapters", "software", "signedInUser"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing %q", k)
		}
	}
	b, _ = json.Marshal(Assemble(Raw{Hostname: "PC"}))
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"disks", "adapters", "software"} {
		if _, ok := m[k].([]any); !ok {
			t.Errorf("%q is %v, want a list", k, m[k])
		}
	}
}
