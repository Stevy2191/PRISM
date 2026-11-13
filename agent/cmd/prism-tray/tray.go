//go:build windows || (darwin && cgo) || (linux && cgo)

// prism-tray: PRISM in the notification area (Windows) or the menu bar
// (macOS), started at each user's sign-in. Its first item is Submit a
// ticket. It never talks to PRISM: everything goes through the PRISM Agent
// service (a named pipe on Windows, a Unix socket on macOS), which knows
// who the user is from the operating system.
//
//	prism-tray        the icon (one per signed-in user)
//	prism-tray form              the window, on its home (the icon starts it)
//	prism-tray form new          … on the new-ticket form
//	prism-tray form ticket <id>  … on one of the person's tickets
//
// This file is shared; platform_windows.go and platform_darwin.go hold the
// differences (single instance, opening links, the web view, the icon).
package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

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
	// The native window (an HWND, NSWindow or GtkWindow), to hide it while
	// the screen is captured.
	Window() unsafe.Pointer
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "form" {
		runForm()
		return
	}
	// The pop-up's own short-lived process (Windows).
	if len(os.Args) > 1 && os.Args[1] == "notify" {
		runNotify(os.Args[2:])
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

// How often the tray asks for notices and replies. The service's read
// limit is 60 requests in 10 minutes for the whole computer.
const homeEvery = 3 * time.Minute

const menuTickets = 3

var stateWord = map[string]string{"open": "Open", "needs_answer": "Needs your answer", "on_hold": "On hold", "done": "Done"}

func onReady() {
	setTrayIcon(false)
	systray.SetTooltip("PRISM: Submit a ticket")
	// Shown, with a dot on the icon, while the help desk has said something
	// this person hasn't looked at yet: it stays until they open it.
	news := systray.AddMenuItem("", "Open it")
	news.Hide()
	submit := systray.AddMenuItem(submitLabel, "Send the help desk a ticket from this computer")
	homeItem := systray.AddMenuItem("My open tickets and notices", "Your open tickets, and notices from the help desk")
	var ticketItems [menuTickets]*systray.MenuItem
	var ticketIDs [menuTickets]int64
	for i := range ticketItems {
		ticketItems[i] = systray.AddMenuItem("", "Open this ticket")
		ticketItems[i].Hide()
	}
	portal := systray.AddMenuItem("Open the support portal", "Your tickets, in the browser")
	portal.Hide()
	systray.AddSeparator()
	status := systray.AddMenuItem("Connecting to the help desk…", "")
	status.Disable()
	about := systray.AddMenuItem("About PRISM Agent "+version.Version, "")
	about.Disable()

	// refresh asks the service who we are, shows it, and says when to ask
	// again (soon while something's wrong).
	refresh := func() time.Duration {
		var a ipc.WhoamiAnswer
		err := ipc.Call(map[string]string{"op": "whoami"}, &a, 30*time.Second)
		title, detail, next := trayui.Status(err, a.Computer, a.Offline, connectedLabel)
		mu.Lock()
		defer mu.Unlock()
		status.SetTitle(title)
		status.SetTooltip(detail)
		if err == nil && trayui.SafePortalURL(a.Helpdesk.PortalURL) {
			portalURL = a.Helpdesk.PortalURL
			portal.Show()
		} else if err == nil && !a.Offline {
			portalURL = ""
			portal.Hide()
		}
		return next
	}
	go func() {
		for {
			time.Sleep(refresh())
		}
	}()
	// The home: the person's tickets in the menu, and the dot.
	// What has already had its pop-up, so each is announced once (and again
	// after the next sign-in, while it's still unread).
	announced := map[string]bool{}
	refreshHome := func() {
		var h ipc.HomeAnswer
		if err := ipc.Call(map[string]string{"op": "home"}, &h, 30*time.Second); err != nil || h.Offline {
			return // keep what was shown
		}
		seen := trayui.LoadSeen(trayui.DraftDir())
		fresh, first := 0, ""
		popups := 0
		announce := func(key, title, body string, ticketID int64) {
			if announced[key] {
				return
			}
			announced[key] = true
			if popups < 3 { // a burst after a long absence stays readable
				popups++
				go notify(trayui.Shorten(title, 60), trayui.Shorten(body, 200), ticketID)
			}
		}
		for _, n := range h.Notices {
			if seen.NewNotice(n.ID) {
				fresh++
				if first == "" {
					first = n.Headline
				}
				announce("n"+strconv.FormatInt(n.ID, 10), n.Headline, n.Message, 0)
			}
		}
		for _, t := range h.Tickets {
			if t.LastReply != nil && seen.NewReply(t.ID, t.LastReply.ID) {
				fresh++
				if first == "" {
					first = t.LastReply.From + " replied: " + t.Title
				}
				announce("r"+strconv.FormatInt(t.LastReply.ID, 10), t.LastReply.From+" replied on \""+trayui.Shorten(t.Title, 40)+"\"", t.LastReply.Snippet, t.ID)
			}
		}
		mu.Lock()
		defer mu.Unlock()
		for i := range ticketItems {
			if i < len(h.Tickets) {
				t := h.Tickets[i]
				ticketIDs[i] = t.ID
				mark := ""
				if t.LastReply != nil && seen.NewReply(t.ID, t.LastReply.ID) {
					mark = "● "
				}
				ticketItems[i].SetTitle(mark + trayui.Shorten(t.Title, 34) + "  ·  " + stateWord[t.State])
				ticketItems[i].Show()
			} else {
				ticketIDs[i] = 0
				ticketItems[i].Hide()
			}
		}
		setTrayIcon(fresh > 0)
		switch {
		case fresh == 1:
			news.SetTitle("● New: " + trayui.Shorten(first, 40))
			news.Show()
			systray.SetTooltip("PRISM: something new from the help desk")
		case fresh > 1:
			news.SetTitle("● " + strconv.Itoa(fresh) + " new from the help desk")
			news.Show()
			systray.SetTooltip("PRISM: something new from the help desk")
		default:
			news.Hide()
			systray.SetTooltip("PRISM: Submit a ticket")
		}
	}
	// Sooner after the window was open: what was seen there clears the dot.
	nudge := make(chan struct{}, 1)
	go func() {
		for {
			refreshHome()
			select {
			case <-time.After(homeEvery):
			case <-nudge:
				time.Sleep(20 * time.Second)
			}
		}
	}()
	opened := func(args ...string) {
		openForm(args...)
		select {
		case nudge <- struct{}{}:
		default:
		}
	}
	for i := range ticketItems {
		i := i
		go func() {
			for range ticketItems[i].ClickedCh {
				mu.Lock()
				id := ticketIDs[i]
				mu.Unlock()
				if id > 0 {
					opened("ticket", strconv.FormatInt(id, 10))
				}
			}
		}()
	}
	go func() {
		for {
			select {
			case <-news.ClickedCh:
				opened()
			case <-homeItem.ClickedCh:
				opened()
			case <-submit.ClickedCh:
				opened("new")
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
func openForm(args ...string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	_ = exec.Command(exe, append([]string{"form"}, args...)...).Start()
}

// runForm is the Submit a ticket window.
func runForm() {
	if !singleInstance(formLock) {
		bringToFront("Help desk")
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
	// Where to open: the home, the new-ticket form, or one ticket.
	start, startTicket := "home", int64(0)
	if len(os.Args) > 2 && os.Args[2] == "new" {
		start = "new"
	} else if len(os.Args) > 3 && os.Args[2] == "ticket" {
		if id, err := strconv.ParseInt(os.Args[3], 10, 64); err == nil && id > 0 {
			start, startTicket = "ticket", id
		}
	}
	home := ipc.HomeAnswer{Notices: []ipc.Notice{}, Tickets: []ipc.HomeTicket{}, Offline: true}
	if !who.Offline {
		_ = ipc.Call(map[string]string{"op": "home"}, &home, 30*time.Second)
	}
	homeJSON, _ := json.Marshal(home)
	seenJSON, _ := json.Marshal(trayui.LoadSeen(draftDir))
	cats, _ := json.Marshal(who.Categories)
	if who.Categories == nil {
		cats = []byte("[]")
	}
	html, err := trayui.Render(trayui.Page{
		HelpdeskName: who.Helpdesk.Name, HelpdeskEmail: who.Helpdesk.Email, PortalURL: who.Helpdesk.PortalURL,
		Name: who.Name, Company: company, Computer: who.Computer,
		Subject: draft.Subject, Description: draft.Description,
		CategoriesJSON: string(cats), Type: draft.Type, CategoryID: draft.CategoryID, CategoryUnsure: draft.CategoryUnsure,
		Start: start, StartTicket: startTicket, HomeJSON: string(homeJSON), SeenJSON: string(seenJSON),
		CanCapture: canCapture(),
	})
	if err != nil {
		return
	}
	// The web view's profile goes in the user's own folder.
	w := newWindow("Help desk", 460, 840, filepath.Join(draftDir, "WebView"))
	if w == nil {
		noWebView(who)
		return
	}
	defer w.Destroy()

	// Bindings run on the UI thread: a send starts in the background and
	// answers through window.prismDone, so the window never freezes.
	// The type and category (9) travel with it, and with a kept draft.
	// Attachments (owner, 2026-11-11) come as JSON: [{name, type, data
	// (base64)}]; they go with the request, not into a kept draft.
	_ = w.Bind("prismSubmitStart", func(subject, description, kind string, categoryID int64, unsure bool, attachments string) {
		go func() {
			var a ipc.SubmitAnswer
			req := ipc.Request{
				Op: "submit", Subject: subject, Description: description,
				Type: kind, CategoryID: categoryID, CategoryUnsure: unsure,
			}
			if attachments != "" && attachments != "[]" {
				if err := json.Unmarshal([]byte(attachments), &req.Attachments); err != nil {
					b, _ := json.Marshal(ipc.SubmitAnswer{Error: "invalid", Message: "The attached files couldn't be read."})
					w.Dispatch(func() { w.Eval("window.prismDone(" + string(b) + ")") })
					return
				}
			}
			wait := 2 * time.Minute
			if len(req.Attachments) > 0 {
				wait = 6 * time.Minute
			}
			if err := ipc.Call(req, &a, wait); err != nil {
				a = ipc.SubmitAnswer{Error: "offline"}
			}
			switch {
			case a.Number != "":
				trayui.ClearDraft(draftDir)
			case a.Error == "offline":
				_ = trayui.SaveDraft(draftDir, trayui.Draft{
					Subject: subject, Description: description, Type: kind, CategoryID: categoryID, CategoryUnsure: unsure,
				})
			}
			b, _ := json.Marshal(a)
			w.Dispatch(func() { w.Eval("window.prismDone(" + string(b) + ")") })
		}()
	})
	// The home again, a ticket's conversation, and a reply: each asks the
	// service in the background and answers through its own callback.
	answer := func(callback string, v any) {
		b, _ := json.Marshal(v)
		w.Dispatch(func() { w.Eval("window." + callback + "(" + string(b) + ")") })
	}
	_ = w.Bind("prismHomeStart", func() {
		go func() {
			h := ipc.HomeAnswer{Notices: []ipc.Notice{}, Tickets: []ipc.HomeTicket{}, Offline: true}
			_ = ipc.Call(map[string]string{"op": "home"}, &h, 30*time.Second)
			answer("prismHomeDone", h)
		}()
	})
	_ = w.Bind("prismTicketStart", func(id int64) {
		go func() {
			var a ipc.TicketAnswer
			if err := ipc.Call(ipc.Request{Op: "ticket", TicketID: id}, &a, 30*time.Second); err != nil {
				a = ipc.TicketAnswer{Error: "offline"}
			}
			answer("prismTicketDone", a)
		}()
	})
	_ = w.Bind("prismReplyStart", func(id int64, body string) {
		go func() {
			var a ipc.ReplyAnswer
			if err := ipc.Call(ipc.Request{Op: "reply", TicketID: id, Body: body}, &a, time.Minute); err != nil {
				a = ipc.ReplyAnswer{Error: "offline"}
			}
			answer("prismReplyDone", a)
		}()
	})
	// Capture my screen: the window steps out of the picture, the screen is
	// read, and the window comes back with it attached.
	_ = w.Bind("prismCaptureStart", func() {
		go func() {
			w.Dispatch(func() { hideWindow(w) })
			time.Sleep(450 * time.Millisecond) // let the desktop redraw without it
			data, mime, ext, err := captureScreen()
			w.Dispatch(func() { showWindow(w) })
			if err != nil {
				answer("prismCaptureDone", map[string]string{"error": err.Error()})
				return
			}
			answer("prismCaptureDone", map[string]any{
				"name": shotName(ext), "type": mime, "size": len(data), "data": base64.StdEncoding.EncodeToString(data),
			})
		}()
	})
	// What the person has looked at, so the tray's dot can clear.
	_ = w.Bind("prismSeen", func(raw string) {
		if s, err := trayui.ParseSeen(raw); err == nil {
			_ = trayui.SaveSeen(draftDir, s)
		}
	})
	_ = w.Bind("prismOpenPortal", func() { openURL(who.Helpdesk.PortalURL) })
	_ = w.Bind("prismClose", func() { w.Dispatch(w.Terminate) })
	_ = w.Bind("prismOpenTicket", func(id int64) {
		if u := trayui.TicketURL(who.Helpdesk.PortalURL, id); u != "" {
			openURL(u)
		}
	})
	w.SetHtml(html)
	w.Run()
}
