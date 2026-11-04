package inventory

import (
	"runtime"
	"time"
)

// CollectSnapshot on macOS: plan 8b, Task 5 (network only until then).
func CollectSnapshot(account, agentVersion string) Snapshot {
	return BuildSnapshot(SnapRaw{OSCaption: runtime.GOOS, Adapters: GoAdapters(), PrimaryIP: PrimaryIP()}, account, agentVersion, time.Now())
}
