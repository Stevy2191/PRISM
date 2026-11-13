//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

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

// Attach (owner, 2026-11-13: the button did nothing on a Mac). The form is
// a process with no Dock icon and no menu bar, so the file panel is shown
// as a sheet on the form's own window, where it can't open behind it, after
// making the form the active app.
@interface PrismUIDelegate : NSObject <WKUIDelegate>
@end
@implementation PrismUIDelegate
- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *URLs))completionHandler {
	NSOpenPanel *panel = [NSOpenPanel openPanel];
	panel.canChooseFiles = YES;
	panel.canChooseDirectories = NO;
	panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
	if (@available(macOS 14.0, *)) {
		[NSApp activate];
	} else {
		[NSApp activateIgnoringOtherApps:YES];
	}
	NSWindow *win = webView.window;
	if (win) {
		[panel beginSheetModalForWindow:win completionHandler:^(NSModalResponse r) {
			completionHandler(r == NSModalResponseOK ? panel.URLs : nil);
		}];
	} else {
		completionHandler([panel runModal] == NSModalResponseOK ? panel.URLs : nil);
	}
}
@end

static PrismUIDelegate *prismUIDelegate;

// A window with no Edit menu gets no Cut, Copy, Paste or Select All: the
// keys go nowhere. Give the form the standard ones, so text and a
// screenshot can be pasted into it.
static void prismEditMenu(void) {
	if ([NSApp mainMenu] != nil) return;
	NSMenu *bar = [[NSMenu alloc] initWithTitle:@""];
	NSMenuItem *appItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
	NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@""];
	[appMenu addItemWithTitle:@"Close" action:@selector(performClose:) keyEquivalent:@"w"];
	appItem.submenu = appMenu;
	[bar addItem:appItem];
	NSMenuItem *editItem = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
	NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Edit"];
	[edit addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
	[[edit addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"z"] setKeyEquivalentModifierMask:NSEventModifierFlagCommand | NSEventModifierFlagShift];
	[edit addItem:[NSMenuItem separatorItem]];
	[edit addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
	[edit addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
	[edit addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
	[edit addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
	editItem.submenu = edit;
	[bar addItem:editItem];
	[NSApp setMainMenu:bar];
}

// Sets the form window up: file panels and the Edit keys.
static void prismFormSetup(void *win) {
	prismEditMenu();
	if (!win) return;
	NSView *view = ((__bridge NSWindow *)win).contentView;
	if ([view isKindOfClass:[WKWebView class]]) {
		if (!prismUIDelegate) prismUIDelegate = [PrismUIDelegate new];
		((WKWebView *)view).UIDelegate = prismUIDelegate;
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

func frontWindow(win unsafe.Pointer) {
	C.prismFormSetup(win)
	C.prismFront(win)
}

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
