package trayui

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stevy2191/prism/agent/internal/ipc"
)

func TestStatus(t *testing.T) {
	cases := []struct {
		name    string
		err     error
		offline bool
		title   string
		detail  bool
		soon    bool
	}{
		{"connected", nil, false, "MAC-01 · connected", false, false},
		{"offline", nil, true, "MAC-01 · can't reach the help desk", false, true},
		{"no service", ipc.ErrNotRunning, false, "The PRISM Agent service isn't running", true, true},
		{"not the service's socket", ipc.ErrUntrusted, false, "PRISM Agent can't verify its service: reinstall it", true, true},
		{"no answer", fmt.Errorf("no answer from the PRISM Agent service: %w", errors.New("EOF")), false, "PRISM Agent can't get an answer from its service", true, true},
	}
	for _, c := range cases {
		title, detail, next := Status(c.err, "MAC-01", c.offline, "connected")
		if title != c.title {
			t.Errorf("%s: title %q, want %q", c.name, title, c.title)
		}
		if (detail != "") != c.detail {
			t.Errorf("%s: detail %q", c.name, detail)
		}
		if c.detail && !strings.Contains(detail, c.err.Error()) {
			t.Errorf("%s: detail %q lacks the error", c.name, detail)
		}
		if want := RefreshWhenFine; c.soon {
			want = RefreshWhenProblem
			if next != want {
				t.Errorf("%s: next %v, want %v", c.name, next, want)
			}
		} else if next != want {
			t.Errorf("%s: next %v, want %v", c.name, next, want)
		}
	}
}
