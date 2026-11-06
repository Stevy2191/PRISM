//go:build darwin && !cgo

// The Mac menu-bar app needs cgo (Cocoa, WKWebView); the package build
// (agent/packaging/macos) has it. Without cgo, only this.
package main

import (
	"fmt"
	"os"
)

func main() {
	_ = trayIcon
	_ = trayTemplateIcon
	fmt.Fprintln(os.Stderr, "prism-tray: built without cgo; the Mac menu-bar app needs it")
	os.Exit(1)
}
