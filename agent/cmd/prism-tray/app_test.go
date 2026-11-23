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

// Past tickets starts this program again with "history". From Help desk.app
// that program is help-desk, which used to open a second Help desk window
// (and a Dock icon per click) instead of Past tickets.
func TestTheInstructionWinsOverTheAppName(t *testing.T) {
	desk := "/Applications/Help desk.app/Contents/MacOS/help-desk"
	tray := "/Applications/Utilities/PRISM Agent.app/Contents/MacOS/prism-tray"
	cases := []struct {
		args []string
		want string
	}{
		{[]string{desk}, "form"},
		{[]string{desk, "-psn_0_42"}, "form"},
		{[]string{desk, "history"}, "history"},
		{[]string{desk, "form", "new"}, "form"},
		{[]string{tray}, "tray"},
		{[]string{tray, "history"}, "history"},
		{[]string{tray, "form"}, "form"},
		{[]string{tray, "notify", "x"}, "notify"},
		{[]string{`C:\Program Files\PRISM\Agent\prism-tray.exe`, "tray"}, "tray"},
	}
	for _, c := range cases {
		if got := launchMode(c.args); got != c.want {
			t.Errorf("launchMode(%q) = %q, want %q", c.args, got, c.want)
		}
	}
}

// Bringing an open window forward finds its process by its own lock:
// Past tickets' is not the Help desk window's (on macOS it used to activate
// the Help desk window, so a Past tickets window behind others stayed there).
func TestEachWindowIsFoundByItsOwnLock(t *testing.T) {
	if got := lockFor("Past tickets"); got != historyLock {
		t.Errorf("lockFor(Past tickets) = %q, want %q", got, historyLock)
	}
	if got := lockFor("Help desk"); got != formLock {
		t.Errorf("lockFor(Help desk) = %q, want %q", got, formLock)
	}
}
