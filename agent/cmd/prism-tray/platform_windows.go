//go:build windows

package main

import (
	"os"
	"unsafe"

	"fyne.io/systray"
	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/trayui"
)

const (
	trayLock       = `Local\PRISMTray`
	formLock       = `Local\PRISMTrayForm`
	submitLabel    = "Submit a ticket"
	connectedLabel = "connected to the help desk"
)

func setTrayIcon(dot bool) { systray.SetIcon(trayIcon(dot)) }

// singleInstance holds a named mutex for the life of the process; false if
// another process already holds it.
func singleInstance(name string) bool {
	n, _ := windows.UTF16PtrFromString(name)
	_, err := windows.CreateMutex(nil, true, n)
	return err == nil
}

func localAccount() string { return os.Getenv("USERDOMAIN") + `\` + os.Getenv("USERNAME") }

// openURL opens an https:// address in the default browser; nothing else.
func openURL(u string) {
	if !trayui.SafePortalURL(u) {
		return
	}
	verb, _ := windows.UTF16PtrFromString("open")
	target, _ := windows.UTF16PtrFromString(u)
	_ = windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}

// newWindow is a WebView2 window (no cgo); nil without the WebView2 runtime.
func newWindow(title string, width, height uint, dataPath string) window {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:      dataPath,
		AutoFocus:     true,
		WindowOptions: webview2.WindowOptions{Title: title, Width: width, Height: height, Center: true},
	})
	if w == nil {
		return nil
	}
	return w
}

// The WebView2 runtime is missing (rare on Windows 10, built into 11): say
// how to reach the help desk instead.
func noWebView(who ipc.WhoamiAnswer) {
	msg := "The ticket window can't open on this computer (Microsoft Edge WebView2 is missing)."
	if who.Helpdesk.Email != "" {
		msg += "\n\nEmail the help desk: " + who.Helpdesk.Email
	}
	if trayui.SafePortalURL(who.Helpdesk.PortalURL) {
		msg += "\nSupport portal: " + who.Helpdesk.PortalURL
	}
	t, _ := windows.UTF16PtrFromString("Submit a ticket")
	m, _ := windows.UTF16PtrFromString(msg)
	_, _ = windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONINFORMATION)
}

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procFindWindowW         = user32.NewProc("FindWindowW")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
)

func bringToFront(title string) {
	t, _ := windows.UTF16PtrFromString(title)
	if h, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(t))); h != 0 {
		_, _, _ = procSetForegroundWindow.Call(h)
	}
}
