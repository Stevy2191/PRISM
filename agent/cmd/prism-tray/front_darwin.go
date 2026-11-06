//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// The form is its own small process with no Dock icon, started by the menu
// bar app; macOS doesn't bring such a process's window forward on its own,
// so it opened behind whatever was in front. Activate it and order the
// window to the front, above other apps' windows.
static void prismFront(void *win) {
	if (@available(macOS 14.0, *)) {
		[NSApp activate];
	} else {
		[NSApp activateIgnoringOtherApps:YES];
	}
	if (win) {
		NSWindow *w = (__bridge NSWindow *)win;
		[w center];
		[w makeKeyAndOrderFront:nil];
		[w orderFrontRegardless];
	}
}

// Brings another of this user's processes (the open form) to the front.
static void prismActivatePID(int pid) {
	NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
	if (@available(macOS 14.0, *)) {
		[app activateWithOptions:NSApplicationActivateAllWindows];
	} else {
		[app activateWithOptions:NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps];
	}
}
*/
import "C"

import (
	"os"
	"strconv"
	"strings"
	"unsafe"
)

func frontWindow(win unsafe.Pointer) { C.prismFront(win) }

// recordPID writes this process's id into its lock file, so the menu bar
// app can bring an open form forward.
func recordPID(f *os.File) {
	_ = f.Truncate(0)
	_, _ = f.WriteAt([]byte(strconv.Itoa(os.Getpid())), 0)
}

// activateForm brings the already-open form to the front, if its lock file
// names a process.
func activateForm() {
	b, err := os.ReadFile(lockPath(formLock))
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 1 || pid == os.Getpid() {
		return
	}
	C.prismActivatePID(C.int(pid))
}
