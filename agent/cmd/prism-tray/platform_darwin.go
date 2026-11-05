//go:build darwin && cgo

package main

import (
	"log"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"

	"fyne.io/systray"
	webview "github.com/webview/webview_go"
	"golang.org/x/sys/unix"

	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/trayui"
)

// Cocoa (the menu bar and WKWebView) must run on the main thread.
func init() { runtime.LockOSThread() }

const (
	trayLock = "prism-tray.lock"
	formLock = "prism-tray-form.lock"
	// Mac menus end items that open a window with an ellipsis (TrayMac board).
	submitLabel    = "Submit a ticket…"
	connectedLabel = "connected"
)

// setTrayIcon: a template icon, so macOS draws it to suit a light or dark
// menu bar.
func setTrayIcon() {
	icon := trayTemplateIcon()
	systray.SetTemplateIcon(icon, icon)
}

// singleInstance holds an exclusive lock on a file in the user's own
// temporary folder for the life of the process.
func singleInstance(name string) bool {
	f, err := os.OpenFile(filepath.Join(os.TempDir(), name), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return false
	}
	if unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) != nil {
		f.Close()
		return false
	}
	recordPID(f)
	// Kept open (and locked) until the process ends.
	return true
}

func localAccount() string {
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return ""
}

// openURL opens an https:// address in the default browser; nothing else.
func openURL(u string) {
	if !trayui.SafePortalURL(u) {
		return
	}
	_ = exec.Command("/usr/bin/open", u).Start()
}

// newWindow is a WKWebView window, following the system's Light or Dark
// appearance (the page's prefers-color-scheme).
func newWindow(title string, width, height uint, _ string) window {
	w := webview.New(false)
	if w == nil {
		return nil
	}
	w.SetTitle(title)
	w.SetSize(int(width), int(height), webview.HintFixed)
	// Once its window is up, bring it in front of every other app's.
	w.Dispatch(func() { frontWindow(w.Window()) })
	return w
}

// WKWebView is part of macOS; this can't happen, but say so in the log.
func noWebView(ipc.WhoamiAnswer) { log.Print("prism-tray: the web view could not be created") }

// The form is already open (in its own process): bring it to the front.
func bringToFront(string) { activateForm() }
