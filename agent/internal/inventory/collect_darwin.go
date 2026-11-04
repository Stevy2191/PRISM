package inventory

import (
	"os"
	"runtime"
)

// Collect on macOS: plan 8b, Task 2 (until then the hostname and network
// only, so `collect` works for development).
func Collect() (Inventory, []error) {
	host, _ := os.Hostname()
	inv := Assemble(Raw{Hostname: host, Adapters: GoAdapters(), PrimaryIP: PrimaryIP(), OSCaption: runtime.GOOS})
	return inv, nil
}
