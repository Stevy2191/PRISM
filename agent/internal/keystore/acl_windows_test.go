//go:build windows

package keystore

import (
	"path/filepath"
	"strings"
	"testing"
)

func aces(t *testing.T, path string) string {
	t.Helper()
	sddl, err := FileACL(path)
	if err != nil {
		t.Fatal(err)
	}
	return sddl
}

// Enrolling as an administrator (the CI runner is one; the owner hit
// "Access is denied" moving the key, 2026-11-05): the staged key allows
// SYSTEM and Administrators so it can be moved into place; once installed
// it allows SYSTEM alone and inherits nothing.
func TestKeyIsMovedIntoPlaceThenSystemOnly(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "PRISM")
	stage := dir + ".enrolling"
	if _, err := Create(stage); err != nil {
		t.Fatal(err)
	}
	if s := aces(t, Path(stage)); !strings.Contains(s, ";;;SY)") || !strings.Contains(s, ";;;BA)") {
		t.Fatalf("staged key ACL %s, want SYSTEM and Administrators", s)
	}
	if err := Install(stage, dir); err != nil {
		t.Fatalf("an administrator couldn't move the key into place: %v", err)
	}
	s := aces(t, Path(dir))
	if !strings.HasPrefix(s, "D:P") || strings.Count(s, "(A;") != 1 || !strings.Contains(s, ";;;SY)") {
		t.Fatalf("installed key ACL %s, want SYSTEM only (D:P(A;;FA;;;SY))", s)
	}
	// And this (non-SYSTEM) test process can't read it.
	if _, err := Load(dir); err == nil {
		t.Fatal("a non-SYSTEM process read the device key")
	}
	// Enrolling again replaces it (the administrator can still remove it:
	// the folder grants Administrators full control, as C:\ProgramData does).
	if _, err := Create(stage); err != nil {
		t.Fatal(err)
	}
	if err := Install(stage, dir); err != nil {
		t.Fatalf("re-enrolling couldn't replace the key: %v", err)
	}
}
