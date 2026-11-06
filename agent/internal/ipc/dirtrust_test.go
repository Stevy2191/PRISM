//go:build darwin || linux

package ipc

import (
	"os"
	"testing"
)

func TestTheSocketFolderRule(t *testing.T) {
	for _, c := range []struct {
		name     string
		perm     uint32
		uid, gid uint32
		want     bool
	}{
		{"macOS /var/run (root:daemon 0775)", 0o775, 0, 1, true},
		{"Linux /run (root:root 0755)", 0o755, 0, 0, true},
		{"root:wheel 0775", 0o775, 0, 0, true},
		{"a group of people may write", 0o775, 0, 20, false},
		{"anyone may write", 0o777, 0, 0, false},
		{"sticky but anyone may write (/tmp)", 0o777 | 0o1000, 0, 0, false},
		{"not root's", 0o755, 501, 20, false},
	} {
		if got := dirTrusted(fileMode(c.perm), c.uid, c.gid, 0); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

func fileMode(p uint32) os.FileMode { return os.FileMode(p).Perm() }
