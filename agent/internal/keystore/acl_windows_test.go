//go:build windows

package keystore

import (
	"strings"
	"testing"
)

// Without the test widening, the key file allows SYSTEM alone, and
// inherits nothing from its folder.
func TestSystemOnlyACL(t *testing.T) {
	dir := t.TempDir()
	if _, err := Create(dir); err != nil {
		t.Fatal(err)
	}
	sddl, err := FileACL(Path(dir))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(sddl, "D:P") || strings.Count(sddl, "(A;") != 1 || !strings.Contains(sddl, ";;;SY)") {
		t.Fatalf("key file ACL %s, want SYSTEM only (D:P(A;;FA;;;SY))", sddl)
	}
	// And this (non-SYSTEM) test process can't read it.
	if _, err := Load(dir); err == nil {
		t.Fatal("a non-SYSTEM process read the device key")
	}
}
