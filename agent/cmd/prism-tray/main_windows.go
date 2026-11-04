//go:build windows

// prism-tray: the PRISM icon in the notification area, started at each
// user's sign-in. Its menu's first item is Submit a ticket. It never talks
// to PRISM: everything goes through the PRISM Agent service's pipe, which
// knows who the user is from Windows.
//
//	prism-tray        the icon (one per signed-in user)
//	prism-tray form   the Submit a ticket window (the icon starts it)
package main

import (
	"os"
	"os/exec"
	"sync"
	"time"

	"fyne.io/systray"
	"golang.org/x/sys/windows"

	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/trayui"
	"github.com/stevy2191/prism/agent/internal/version"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "form" {
		runForm()
		return
	}
	// One icon per sign-in session.
	if !singleInstance(`Local\PRISMTray`) {
		return
	}
	systray.Run(onReady, func() {})
}

// singleInstance holds a named mutex for the life of the process; false if
// another process already holds it.
func singleInstance(name string) bool {
	n, _ := windows.UTF16PtrFromString(name)
	_, err := windows.CreateMutex(nil, true, n)
	return err == nil
}

var (
	mu        sync.Mutex
	portalURL string
)

func onReady() {
	systray.SetIcon(trayIcon())
	systray.SetTooltip("PRISM: Submit a ticket")
	submit := systray.AddMenuItem("Submit a ticket", "Send the help desk a ticket from this computer")
	portal := systray.AddMenuItem("Open the support portal", "Your tickets, in the browser")
	portal.Hide()
	systray.AddSeparator()
	status := systray.AddMenuItem("Connecting to the help desk…", "")
	status.Disable()
	about := systray.AddMenuItem("About PRISM Agent "+version.Version, "")
	about.Disable()

	refresh := func() {
		var a ipc.WhoamiAnswer
		err := ipc.Call(map[string]string{"op": "whoami"}, &a, 30*time.Second)
		mu.Lock()
		defer mu.Unlock()
		switch {
		case err != nil:
			status.SetTitle("The PRISM Agent service isn't running")
		case a.Offline:
			status.SetTitle(a.Computer + " · can't reach the help desk")
		default:
			status.SetTitle(a.Computer + " · connected to the help desk")
		}
		if err == nil && trayui.SafePortalURL(a.Helpdesk.PortalURL) {
			portalURL = a.Helpdesk.PortalURL
			portal.Show()
		} else if err == nil && !a.Offline {
			portalURL = ""
			portal.Hide()
		}
	}
	go func() {
		for {
			refresh()
			time.Sleep(5 * time.Minute)
		}
	}()
	go func() {
		for {
			select {
			case <-submit.ClickedCh:
				openForm()
			case <-portal.ClickedCh:
				mu.Lock()
				u := portalURL
				mu.Unlock()
				openURL(u)
			}
		}
	}()
}

// openForm starts the window as its own process (its own UI thread and
// WebView2); the form allows one window at a time.
func openForm() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	_ = exec.Command(exe, "form").Start()
}

// openURL opens an https:// address in the default browser; nothing else.
func openURL(u string) {
	if !trayui.SafePortalURL(u) {
		return
	}
	verb, _ := windows.UTF16PtrFromString("open")
	target, _ := windows.UTF16PtrFromString(u)
	_ = windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}
