//go:build !windows

// Package service: the platform's service manager. macOS (launchd) and
// Linux (systemd) arrive with 8b and 8c; until then `run` is a foreground
// process there.
package service

import (
	"context"
	"errors"
)

func IsService() bool { return false }

func Run(run func(ctx context.Context, logf func(string, ...any))) error {
	return errors.New("not supported on this platform yet")
}

func Install() error   { return errors.New("not supported on this platform yet (8b, 8c)") }
func Uninstall() error { return errors.New("not supported on this platform yet (8b, 8c)") }
