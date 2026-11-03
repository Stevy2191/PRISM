//go:build !windows

package keystore

import "os"

// macOS and Linux for now: the seed in a file only root can read. 8b moves
// macOS to the System keychain.
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

// AllowCurrentUserForTests is Windows-only; elsewhere the 0600 file is
// already readable by the user who wrote it.
func AllowCurrentUserForTests() func() { return func() {} }
