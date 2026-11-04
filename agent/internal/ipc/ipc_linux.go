package ipc

import (
	"context"
	"errors"
	"time"
)

// Linux: a Unix socket with the peer's credentials (SO_PEERCRED), 8c.

// ErrNotRunning: the service isn't running.
var ErrNotRunning = errors.New("the PRISM Agent service isn't running")

// Handler answers one request from an identified user.
type Handler func(ctx context.Context, id Identity, line []byte) any

// Serve waits for ctx: no tray on this platform yet.
func Serve(ctx context.Context, _ Handler, _ func(string, ...any)) error {
	<-ctx.Done()
	return nil
}

// Call: no tray on this platform yet.
func Call(_ any, _ any, _ time.Duration) error { return ErrNotRunning }
