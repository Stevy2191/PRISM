//go:build windows || (darwin && cgo) || (linux && cgo)

package main

import "testing"

// macOS's /Applications/Help desk.app runs this program as help-desk: that
// opens the Help desk window, not a second menu-bar icon.
func TestLaunchedAsTheHelpDeskApp(t *testing.T) {
	for arg0, want := range map[string]bool{
		"/Applications/Help desk.app/Contents/MacOS/help-desk":              true,
		`C:\Program Files\PRISM\help-desk.exe`:                              true,
		"/usr/bin/prism-tray":                                               false,
		"/Applications/Utilities/PRISM Agent.app/Contents/MacOS/prism-tray": false,
		"": false,
	} {
		if got := launchedAsApp(arg0); got != want {
			t.Errorf("launchedAsApp(%q) = %v, want %v", arg0, got, want)
		}
	}
}
