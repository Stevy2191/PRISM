//go:build !windows

package inventory

import (
	"runtime"
	"time"
)

// CollectSnapshot on macOS and Linux arrives with 8b and 8c: network only.
func CollectSnapshot(account, agentVersion string) Snapshot {
	return BuildSnapshot(SnapRaw{OSCaption: runtime.GOOS, Adapters: GoAdapters(), PrimaryIP: PrimaryIP()}, account, agentVersion, time.Now())
}
