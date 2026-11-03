package keystore

import (
	"errors"
	"os"
	"runtime"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	// The key file is SYSTEM-only (see TestSystemOnlyACL); a test isn't
	// SYSTEM, so it is let in to read back what it wrote.
	defer AllowCurrentUserForTests()()
	dir := t.TempDir()
	if _, err := Load(dir); !errors.Is(err, ErrNoKey) {
		t.Fatalf("Load before Create: %v, want ErrNoKey", err)
	}
	key, err := Create(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(key) {
		t.Fatal("Load returned a different key")
	}
	raw, _ := os.ReadFile(Path(dir))
	if runtime.GOOS == "windows" && string(raw) == string(key.Seed()) {
		t.Fatal("the seed is stored unprotected")
	}
	if runtime.GOOS != "windows" {
		st, _ := os.Stat(Path(dir))
		if st.Mode().Perm() != 0o600 {
			t.Fatalf("key file mode %v, want 0600", st.Mode().Perm())
		}
	}
	// A new Create is a new identity.
	key2, _ := Create(dir)
	if key2.Equal(key) {
		t.Fatal("Create reused the old key")
	}
}
