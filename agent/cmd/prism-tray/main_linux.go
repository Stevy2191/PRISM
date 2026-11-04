// prism-tray on Linux arrives with 8c.
package main

import (
	"fmt"
	"os"
)

func main() {
	_ = trayIcon
	fmt.Fprintln(os.Stderr, "prism-tray: the Linux tray app arrives with 8c")
	os.Exit(1)
}
