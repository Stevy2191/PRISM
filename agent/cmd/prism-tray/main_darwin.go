// prism-tray on macOS: the menu-bar app, plan 8b, Task 7.
package main

import (
	"fmt"
	"os"
)

func main() {
	_ = trayIcon
	fmt.Fprintln(os.Stderr, "prism-tray: the Mac menu-bar app is not built yet (plan 8b)")
	os.Exit(1)
}
