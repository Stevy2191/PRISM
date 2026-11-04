//go:build windows || (darwin && cgo)

// prism-tray: PRISM in the notification area (Windows) or the menu bar
// (macOS), started at each user's sign-in. Its first item is Submit a
// ticket. It never talks to PRISM: everything goes through the PRISM Agent
// service (a named pipe on Windows, a Unix socket on macOS), which knows
// who the user is from the operating system.
//
//	prism-tray        the icon (one per signed-in user)
//	prism-tray form   the Submit a ticket window (the icon starts it)
//
// This file is shared; platform_windows.go and platform_darwin.go hold the
// differences (single instance, opening links, the web view, the icon).
package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fyne.io/systray"

	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/trayui"
	"github.com/stevy2191/prism/agent/internal/version"
)

// window is what the form needs from a web view (WebView2 on Windows,
// WKWebView on macOS; both libraries have these).
type window interface {
	Run()
	Terminate()
	Dispatch(f func())
	Destroy()
	SetHtml(html string)
	Eval(js string)
	Bind(name string, f interface{}) error
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "form" {
		runForm()
		return
	}
	// One icon per sign-in session.
	if !singleInstance(trayLock) {
		return
	}
	systray.Run(onReady, func() {})
}

var (
	mu        sync.Mutex
	portalURL string
)

func onReady() {
	setTrayIcon()
	systray.SetTooltip("PRISM: Submit a ticket")
	submit := systray.AddMenuItem(submitLabel, "Send the help desk a ticket from this computer")
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
			status.SetTitle(a.Computer + " · " + connectedLabel)
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
// web view); the form allows one window at a time.
func openForm() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	_ = exec.Command(exe, "form").Start()
}

// runForm is the Submit a ticket window.
func runForm() {
	if !singleInstance(formLock) {
		bringToFront("Submit a ticket")
		return
	}
	var who ipc.WhoamiAnswer
	if err := ipc.Call(map[string]string{"op": "whoami"}, &who, 30*time.Second); err != nil {
		host, _ := os.Hostname()
		who = ipc.WhoamiAnswer{Computer: host, Offline: true}
	}
	if who.Name == "" {
		who.Name = localAccount()
	}
	company := who.Company
	if who.Department != "" {
		company = strings.TrimSpace(company + " · " + who.Department)
	}
	draftDir := trayui.DraftDir()
	draft, _ := trayui.LoadDraft(draftDir)
	html, err := trayui.Render(trayui.Page{
		HelpdeskName: who.Helpdesk.Name, HelpdeskEmail: who.Helpdesk.Email, PortalURL: who.Helpdesk.PortalURL,
		Name: who.Name, Company: company, Computer: who.Computer,
		Subject: draft.Subject, Description: draft.Description,
	})
	if err != nil {
		return
	}
	// The web view's profile goes in the user's own folder.
	w := newWindow("Submit a ticket", 460, 660, filepath.Join(draftDir, "WebView"))
	if w == nil {
		noWebView(who)
		return
	}
	defer w.Destroy()

	// Bindings run on the UI thread: a send starts in the background and
	// answers through window.prismDone, so the window never freezes.
	_ = w.Bind("prismSubmitStart", func(subject, description string) {
		go func() {
			var a ipc.SubmitAnswer
			if err := ipc.Call(map[string]string{"op": "submit", "subject": subject, "description": description}, &a, 2*time.Minute); err != nil {
				a = ipc.SubmitAnswer{Error: "offline"}
			}
			switch {
			case a.Number != "":
				trayui.ClearDraft(draftDir)
			case a.Error == "offline":
				_ = trayui.SaveDraft(draftDir, trayui.Draft{Subject: subject, Description: description})
			}
			b, _ := json.Marshal(a)
			w.Dispatch(func() { w.Eval("window.prismDone(" + string(b) + ")") })
		}()
	})
	_ = w.Bind("prismClose", func() { w.Dispatch(w.Terminate) })
	_ = w.Bind("prismOpenTicket", func(id int64) {
		if u := trayui.TicketURL(who.Helpdesk.PortalURL, id); u != "" {
			openURL(u)
		}
	})
	w.SetHtml(html)
	w.Run()
}
