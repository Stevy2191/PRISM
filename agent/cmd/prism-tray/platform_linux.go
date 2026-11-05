//go:build linux && cgo

package main

import (
	"log"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"

	"fyne.io/systray"
	webview "github.com/webview/webview_go"
	"golang.org/x/sys/unix"

	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/trayui"
)

// GTK (the ticket window) must run on the main thread.
func init() { runtime.LockOSThread() }

const (
	trayLock = "prism-tray.lock"
	formLock = "prism-tray-form.lock"
	// GNOME and KDE end items that open a window with an ellipsis, as macOS.
	submitLabel    = "Submit a ticket…"
	connectedLabel = "connected to the help desk"
)

// setTrayIcon: the StatusNotifierItem shows the boxed P. On GNOME without
// the AppIndicator extension nothing shows; the "Submit a ticket" launcher
// app is the way in there.
func setTrayIcon() { systray.SetIcon(trayPNG()) }

// lockPath: $XDG_RUNTIME_DIR (/run/user/<uid>: the user's own, cleared at
// sign-out), else the user's cache folder.
func lockPath(name string) string {
	if d := os.Getenv("XDG_RUNTIME_DIR"); d != "" {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			return filepath.Join(d, name)
		}
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	} else {
		dir = filepath.Join(dir, "PRISM")
		_ = os.MkdirAll(dir, 0o700)
	}
	return filepath.Join(dir, name)
}

// singleInstance holds an exclusive lock for the life of the process, and
// writes its pid there (so a second launch can say the window is open).
func singleInstance(name string) bool {
	f, err := os.OpenFile(lockPath(name), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return false
	}
	if unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) != nil {
		f.Close()
		return false
	}
	_ = f.Truncate(0)
	_, _ = f.WriteAt([]byte(strconv.Itoa(os.Getpid())), 0)
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
	_ = exec.Command("/usr/bin/xdg-open", u).Start()
}

// newWindow is a WebKitGTK window, following the GTK theme's light or dark
// preference (the page's prefers-color-scheme).
func newWindow(title string, width, height uint, _ string) window {
	w := webview.New(false)
	if w == nil {
		return nil
	}
	w.SetTitle(title)
	w.SetSize(int(width), int(height), webview.HintFixed)
	return w
}

// WebKitGTK is a dependency of the package; say so in the log if it fails.
func noWebView(ipc.WhoamiAnswer) {
	log.Print("prism-tray: the web view could not be created (is WebKitGTK 4.1 installed?)")
}

// The window is already open in another process: window managers don't let
// one process raise another's window, so it stays where it is (a second
// "Submit a ticket" does nothing rather than open a second window).
func bringToFront(string) {}
