//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework CoreGraphics
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>

static void prismHide(void *win) { if (win) [(__bridge NSWindow *)win orderOut:nil]; }
static void prismShow(void *win) {
	if (!win) return;
	if (@available(macOS 14.0, *)) { [NSApp activate]; } else { [NSApp activateIgnoringOtherApps:YES]; }
	[(__bridge NSWindow *)win makeKeyAndOrderFront:nil];
}

// macOS only shows other apps' windows to an app the person has allowed
// under Screen Recording. Asking opens the system's own prompt, once.
static int prismMayCapture(void) {
	if (@available(macOS 10.15, *)) {
		if (CGPreflightScreenCaptureAccess()) return 1;
		CGRequestScreenCaptureAccess();
		return 0;
	}
	return 1;
}
*/
import "C"

import (
	"context"
	"errors"
	"os/exec"
	"time"
)

func canCapture() bool { return true }

func hideWindow(w window) { C.prismHide(w.Window()) }
func showWindow(w window) { C.prismShow(w.Window()) }

// captureScreen uses macOS's own screencapture (-x: no shutter sound).
func captureScreen() ([]byte, string, string, error) {
	if C.prismMayCapture() == 0 {
		return nil, "", "", errors.New("macOS needs your permission first. Allow PRISM under System Settings › Privacy & Security › Screen Recording, then try again.")
	}
	return shotFromTool(func(path string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, "/usr/sbin/screencapture", "-x", "-t", "png", path).Run()
	})
}
