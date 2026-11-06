//go:build linux && !cgo

// The Linux tray needs cgo (WebKitGTK for the ticket window); the package
// build always has it. Without cgo, `go build ./cmd/...` still succeeds.
package main

import (
	"fmt"
	"os"
)

func main() {
	_ = trayIcon
	_ = trayTemplateIcon
	fmt.Fprintln(os.Stderr, "prism-tray: built without cgo; the Linux tray needs it")
	os.Exit(1)
}
