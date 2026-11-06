//go:build darwin || linux

package keystore

import (
	"os"
	"strings"
	"testing"
)

// A key file others could read, a symlink in its place, and a missing one.
func TestKeyFileMustBeTheOwnersAlone(t *testing.T) {
	dir := t.TempDir()
	if _, err := Create(dir); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(Path(dir))
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("created with mode %v", st.Mode().Perm())
	}
	if _, err := Load(dir); err != nil {
		t.Fatalf("a 0600 key refused: %v", err)
	}
	_ = os.Chmod(Path(dir), 0o644)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "readable by others") {
		t.Fatalf("a 0644 key was used: %v", err)
	}
	_ = os.Chmod(Path(dir), 0o600)
	other := t.TempDir()
	if _, err := Create(other); err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(Path(dir))
	if err := os.Symlink(Path(other), Path(dir)); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "not a plain file") {
		t.Fatalf("a symlinked key was used: %v", err)
	}
	if _, err := Load(t.TempDir()); err != ErrNoKey {
		t.Fatalf("missing key: %v", err)
	}
}
