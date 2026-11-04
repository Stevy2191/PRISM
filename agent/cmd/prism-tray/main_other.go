//go:build !windows

// prism-tray on macOS and Linux arrives with 8b and 8c.
package main

import (
	"fmt"
	"os"
)

func main() {
	_ = trayIcon
	fmt.Fprintln(os.Stderr, "prism-tray: the tray app on this platform arrives with 8b (macOS) and 8c (Linux)")
	os.Exit(1)
}
