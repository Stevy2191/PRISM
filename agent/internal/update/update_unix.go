//go:build darwin || linux

package update

import "os"

// The updates folder is root's alone (0700); see update.go.
func prepareDir(dir string) error { return os.MkdirAll(dir, 0o700) }
