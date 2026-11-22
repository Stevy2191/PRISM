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

// Opening the app again while the tray is running (double-clicking
// PRISM Agent.app, or prism-tray.exe) opens the window; an installer
// starting the tray ("tray") never does.
func TestASecondLaunchByAPersonOpensTheWindow(t *testing.T) {
	cases := []struct {
		args []string
		want bool
	}{
		{[]string{"/Applications/Utilities/PRISM Agent.app/Contents/MacOS/prism-tray"}, true},
		{[]string{`C:\Program Files\PRISM\Agent\prism-tray.exe`}, true},
		{[]string{"/Applications/Utilities/PRISM Agent.app/Contents/MacOS/prism-tray", "-psn_0_12345"}, true},
		{[]string{`C:\Program Files\PRISM\Agent\prism-tray.exe`, "tray"}, false},
		{[]string{"prism-tray", "notify", "x"}, false},
	}
	for _, c := range cases {
		if got := openWindowOnRelaunch(c.args); got != c.want {
			t.Errorf("openWindowOnRelaunch(%q) = %v, want %v", c.args, got, c.want)
		}
	}
}
