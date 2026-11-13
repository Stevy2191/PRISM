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

// Asks macOS to show its own Screen Recording prompt (once per install).
static void prismAskCapture(void) {
	if (@available(macOS 10.15, *)) { CGRequestScreenCaptureAccess(); }
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
//
// It is simply tried. macOS's "may I?" check (CGPreflightScreenCaptureAccess)
// answered no on a Mac where PRISM Agent was switched on under Screen
// Recording (owner, 2026-11-13, macOS 26), so it isn't asked first: only
// when screencapture itself fails is the person sent to the setting.
func captureScreen() ([]byte, string, string, error) {
	data, mime, ext, err := shotFromTool(func(path string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, "/usr/sbin/screencapture", "-x", "-t", "png", path).Run()
	})
	if err != nil {
		C.prismAskCapture()
		return nil, "", "", errors.New("macOS didn't allow a picture of the screen. Under System Settings › Privacy & Security › Screen & System Audio Recording, switch PRISM Agent off and on again (or remove it and add it back), then try again.")
	}
	return data, mime, ext, nil
}
