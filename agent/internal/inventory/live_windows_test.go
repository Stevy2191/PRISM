//go:build windows

package inventory

import (
	"encoding/json"
	"testing"
)

// The real thing, on the Windows CI runner: a serial, an OS, a disk.
func TestCollectOnThisComputer(t *testing.T) {
	inv, problems := Collect()
	for _, p := range problems {
		t.Logf("problem: %v", p)
	}
	if inv.Hostname == "" || inv.OS.Edition == "" || inv.OS.Build == "" {
		t.Fatalf("no hostname or OS: %+v", inv)
	}
	if inv.SerialNumber == "" {
		t.Errorf("no serial number (make %q, model %q)", inv.Make, inv.Model)
	}
	if len(inv.Disks) == 0 || inv.MemoryBytes == 0 || inv.CPU.Model == "" {
		t.Fatalf("missing hardware: %+v", inv)
	}
	if len(inv.Software) == 0 {
		t.Errorf("no software found")
	}
	b, _ := json.MarshalIndent(inv, "", "  ")
	if len(b) > 1<<20 {
		t.Fatalf("payload %d bytes, over PRISM's 1 MB", len(b))
	}
	t.Logf("%s", b)
}
