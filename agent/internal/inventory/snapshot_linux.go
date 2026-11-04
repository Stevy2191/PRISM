package inventory

import (
	"runtime"
	"time"
)

// CollectSnapshot on Linux arrives with 8c: network only until then.
func CollectSnapshot(account, agentVersion string) Snapshot {
	return BuildSnapshot(SnapRaw{OSCaption: runtime.GOOS, Adapters: GoAdapters(), PrimaryIP: PrimaryIP()}, account, agentVersion, time.Now())
}
