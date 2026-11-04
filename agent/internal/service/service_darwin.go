// Package service: the platform's service manager. On macOS, launchd:
// plan 8b, Task 5. Until then `run` is a foreground process.
package service

import (
	"context"
	"errors"
)

func IsService() bool { return false }

func Run(run func(ctx context.Context, logf func(string, ...any))) error {
	return errors.New("not supported on this platform yet")
}

func Install() error   { return errors.New("not supported on macOS yet (plan 8b, Task 5)") }
func Uninstall() error { return errors.New("not supported on macOS yet (plan 8b, Task 5)") }
