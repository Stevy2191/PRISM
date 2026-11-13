//go:build (darwin && cgo) || (linux && cgo)

package main

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// A pop-up from the system's own notifier, where there is one (owner,
// 2026-11-13). The text is passed as arguments, never built into a script.
// Clicking it can't open the ticket here: the dot on the icon and the menu
// do that.
func notify(title, body string, _ int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if runtime.GOOS == "darwin" {
		_ = exec.CommandContext(ctx, "/usr/bin/osascript",
			"-e", "on run argv",
			"-e", "display notification (item 2 of argv) with title (item 1 of argv)",
			"-e", "end run", title, body).Run()
		return
	}
	const tool = "/usr/bin/notify-send"
	if st, err := os.Stat(tool); err != nil || !st.Mode().IsRegular() {
		return
	}
	_ = exec.CommandContext(ctx, tool, "--app-name=PRISM", "--", title, body).Run()
}

func runNotify([]string) {}
