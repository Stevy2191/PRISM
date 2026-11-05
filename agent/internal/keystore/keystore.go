// Package keystore keeps the device's Ed25519 identity key: made once at
// enrolment, read by the service at every start. The private key never
// leaves the computer; PRISM has only the public half.
//
// Windows (keystore_windows.go): the 32-byte seed is protected with DPAPI
// (machine scope, so the SYSTEM service can read what an elevated installer
// wrote) in a file whose ACL allows SYSTEM alone. macOS and Linux
// (keystore_unix.go) are a file only root can read (0600); the macOS
// keychain waits for a Developer ID (plan 8b, Notes on the spec).
package keystore

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// FileName is the key file in the agent's data folder.
const FileName = "device.key"

// ErrNoKey: no key has been made yet.
var ErrNoKey = errors.New("no device key")

// Path is the key file in dir.
func Path(dir string) string { return filepath.Join(dir, FileName) }

// Exists: a key file is there (it may only be readable by SYSTEM).
func Exists(dir string) bool {
	_, err := os.Stat(Path(dir))
	return err == nil
}

// Load reads the device key from dir.
func Load(dir string) (ed25519.PrivateKey, error) {
	if err := checkFile(Path(dir)); err != nil {
		return nil, err
	}
	blob, err := os.ReadFile(Path(dir))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNoKey
	}
	if err != nil {
		return nil, err
	}
	seed, err := unprotect(blob)
	if err != nil {
		return nil, fmt.Errorf("the device key cannot be read: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("the device key is damaged")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// Create makes a new key and saves it in dir, replacing any old one
// (re-enrolling is a new identity).
// Install moves a key made by Create in stage into dir (replacing one that
// is there) and seals it: on Windows, SYSTEM only from then on.
func Install(stage, dir string) error {
	from, to := Path(stage), Path(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := os.Rename(from, to); err != nil {
		// A stale file in the way: remove it and try once more.
		_ = os.Remove(to)
		if err := os.Rename(from, to); err != nil {
			return err
		}
	}
	return seal(to)
}

func Create(dir string) (ed25519.PrivateKey, error) {
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	blob, err := protect(seed)
	if err != nil {
		return nil, err
	}
	if err := writeRestricted(Path(dir), blob); err != nil {
		return nil, err
	}
	return ed25519.NewKeyFromSeed(seed), nil
}
