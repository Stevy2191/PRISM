package inventory

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The real thing, on the macos-latest runner (a virtual Mac).
func TestCollectOnThisMac(t *testing.T) {
	inv, problems := Collect()
	for _, p := range problems {
		t.Logf("problem: %v", p)
	}
	if inv.Hostname == "" || inv.Make != "Apple" || inv.OS.Name != "macOS" || inv.OS.Version == "" || inv.OS.Build == "" {
		t.Fatalf("identity or OS missing: %+v", inv)
	}
	if inv.SerialNumber == "" {
		// Virtual Macs may report none; a real one always does.
		t.Logf("no serial number (model %q)", inv.Model)
	}
	if inv.MemoryBytes == 0 || inv.CPU.Model == "" || inv.CPU.Cores == 0 || inv.LastBootAt == "" {
		t.Fatalf("hardware missing: %+v", inv)
	}
	if len(inv.Disks) == 0 || inv.Disks[0].Kind != "fixed" {
		t.Fatalf("no internal disk: %+v", inv.Disks)
	}
	if len(inv.Software) == 0 {
		t.Fatal("no apps found in /Applications")
	}
	b, _ := json.MarshalIndent(inv, "", "  ")
	if len(b) > 1<<20 {
		t.Fatalf("payload %d bytes, over PRISM's 1 MB", len(b))
	}
	t.Logf("%s", b)
}

// This process's own user, as the tray's socket will see it (Task 4).
func TestMacUserForThisProcess(t *testing.T) {
	u, domain, err := MacUserFor(uint32(os.Getuid()))
	if err != nil {
		t.Fatal(err)
	}
	if os.Getuid() == 0 {
		if u != nil {
			t.Fatalf("root became a person: %+v", u)
		}
		return
	}
	if u == nil || u.Account == "" {
		t.Fatal("no account for this user")
	}
	if domain == "" && strings.Contains(u.Account, `\`) {
		t.Fatalf("an unbound Mac gave a domain account %q", u.Account)
	}
	t.Logf("account %q, upn %q, domain %q", u.Account, u.UPN, domain)
	if _, _, err := MacUserFor(0); err != nil {
		t.Fatalf("root lookup: %v", err)
	}
}
