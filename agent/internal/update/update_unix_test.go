//go:build darwin || linux

package update

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTheUpdatesFolderIsResetToOwnerOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "updates")
	if err := prepareDir(dir); err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(dir, 0o777)
	if err := prepareDir(dir); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(dir); st.Mode().Perm() != 0o700 {
		t.Fatalf("mode %v, want 0700", st.Mode().Perm())
	}
	// A symlink in its place is refused, even to a folder of our own.
	link := filepath.Join(t.TempDir(), "updates")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	if err := prepareDir(link); err == nil {
		t.Fatal("a symlinked updates folder was used")
	}
}
