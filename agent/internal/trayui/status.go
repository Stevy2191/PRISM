package trayui

import (
	"errors"
	"time"

	"github.com/stevy2191/prism/agent/internal/ipc"
)

// How often the tray asks the service again: rarely once all is well, and
// soon while something's wrong, so it catches up with an enrolment, a
// service restart or the network coming back without the user waiting.
const (
	RefreshWhenFine    = 5 * time.Minute
	RefreshWhenProblem = 30 * time.Second
)

// Status is the tray's status line for the answer to a whoami: the title,
// the error behind it (for the tooltip; empty when fine), and when to ask
// again. Only a missing service says the service isn't running; anything
// else says what it is.
func Status(err error, computer string, offline bool, connected string) (title, detail string, next time.Duration) {
	switch {
	case err == nil && offline:
		return computer + " · can't reach the help desk", "", RefreshWhenProblem
	case err == nil:
		return computer + " · " + connected, "", RefreshWhenFine
	case errors.Is(err, ipc.ErrNotRunning):
		return "The PRISM Agent service isn't running", err.Error(), RefreshWhenProblem
	case errors.Is(err, ipc.ErrUntrusted):
		return "PRISM Agent can't verify its service: reinstall it", err.Error(), RefreshWhenProblem
	default:
		return "PRISM Agent can't get an answer from its service", err.Error(), RefreshWhenProblem
	}
}
