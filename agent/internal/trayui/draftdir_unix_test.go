//go:build linux || darwin

package trayui

import (
	"os"
	"path/filepath"
	"testing"
)

// The draft is the user's own: ~/.config/PRISM on Linux (Application
// Support on macOS), never a shared folder.
func TestDraftDirIsTheUsersOwn(t *testing.T) {
	t.Setenv("LOCALAPPDATA", "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", "")
	want, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	if got := DraftDir(); got != filepath.Join(want, "PRISM") || !filepath.HasPrefix(got, home) {
		t.Fatalf("DraftDir %q, want %q under %q", got, filepath.Join(want, "PRISM"), home)
	}
}
