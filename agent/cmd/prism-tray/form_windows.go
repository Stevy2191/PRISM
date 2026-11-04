//go:build windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/trayui"
)

// runForm is the Submit a ticket window.
func runForm() {
	if !singleInstance(`Local\PRISMTrayForm`) {
		bringToFront("Submit a ticket")
		return
	}
	var who ipc.WhoamiAnswer
	if err := ipc.Call(map[string]string{"op": "whoami"}, &who, 30*time.Second); err != nil {
		host, _ := os.Hostname()
		who = ipc.WhoamiAnswer{Computer: host, Offline: true}
	}
	if who.Name == "" {
		who.Name = os.Getenv("USERDOMAIN") + `\` + os.Getenv("USERNAME")
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
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		// WebView2's profile goes in the user's own folder (Program Files
		// isn't writable).
		DataPath:  filepath.Join(draftDir, "WebView2"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: "Submit a ticket", Width: 460, Height: 660, Center: true,
		},
	})
	if w == nil {
		noWebView(who)
		return
	}
	defer w.Destroy()

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
	if h, _, _ := procFindWindowW.Call(0, uintptr(unsafePointer(t))); h != 0 {
		_, _, _ = procSetForegroundWindow.Call(h)
	}
}
