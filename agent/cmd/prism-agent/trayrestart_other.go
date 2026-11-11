//go:build !windows

package main

// restartTraysAfterUpdate: the Mac's package restarts the menu bar app
// itself (postinstall), and a Linux update leaves the running tray as it is.
func restartTraysAfterUpdate(func(string, ...any)) {}
