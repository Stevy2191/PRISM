//go:build darwin || linux

package keystore

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

// macOS and Linux: the seed in a file only root can read (0600). On macOS
// this stays until there is a Developer ID (plan 8b, Notes on the spec).
func protect(seed []byte) ([]byte, error)   { return append([]byte(nil), seed...), nil }
func unprotect(blob []byte) ([]byte, error) { return blob, nil }

func writeRestricted(path string, data []byte) error {
	_ = os.Remove(path)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// seal: the 0600 file is root's from the start; nothing to narrow.
func seal(string) error { return nil }

// AllowCurrentUserForTests is Windows-only; elsewhere the 0600 file is
// already readable by the user who wrote it.
func AllowCurrentUserForTests() func() { return func() {} }

// checkFile refuses a key file anyone else could read, or that belongs to
// someone other than the user the agent runs as (root, for the service): a
// key that leaked once can't be trusted. A missing file is left to Load.
func checkFile(path string) error {
	st, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("the device key %s is not a plain file", path)
	}
	if st.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("the device key %s is readable by others (mode %v); enrol again", path, st.Mode().Perm())
	}
	if sys, ok := st.Sys().(*syscall.Stat_t); ok && int(sys.Uid) != os.Geteuid() {
		return fmt.Errorf("the device key %s belongs to another user", path)
	}
	return nil
}
