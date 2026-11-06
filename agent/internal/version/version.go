// Package version holds the agent's version, stamped at build time:
//
//	go build -ldflags "-X github.com/stevy2191/prism/agent/internal/version.Version=0.6.0"
package version

// Version is "dev" in a build that wasn't stamped. PRISM accepts it, and any
// published package is newer than it.
var Version = "dev"
