// Package service: the platform's service manager. On Linux, systemd
// arrives with 8c; until then `run` is a foreground process.
package service

import (
	"context"
	"errors"
)

func IsService() bool { return false }

func Run(run func(ctx context.Context, logf func(string, ...any))) error {
	return errors.New("not supported on this platform yet")
}

func Install() error   { return errors.New("not supported on Linux yet (8c)") }
func Uninstall() error { return errors.New("not supported on Linux yet (8c)") }

// Remove: Linux packages arrive with 8c (and their package manager removes
// them).
func Remove(bool, string) error { return errors.New("not supported on Linux yet (8c)") }

// StartLog: nothing to do here.
func StartLog() {}
