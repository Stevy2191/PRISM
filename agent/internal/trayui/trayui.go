// Package trayui is the tray's "Submit a ticket" window: the page (per the
// TrayForm and TraySent boards, following the system's light or dark
// setting) and the draft kept while the help desk can't be reached. The
// window itself (WebView2) is in cmd/prism-tray.
package trayui

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"html/template"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

//go:embed form.html
var formHTML string

var formTmpl = template.Must(template.New("form").Parse(formHTML))

// Page is what the form shows. Every value is escaped by html/template.
type Page struct {
	HelpdeskName  string
	HelpdeskEmail string
	PortalURL     string // https://…/portal, or "" when the portal is off
	Name          string
	Company       string // "Company · Department"
	Computer      string
	Subject       string // from a kept draft
	Description   string
	// The company's categories as JSON (9), read by the page's script; "[]"
	// when there are none (offline, or an older PRISM): no category step.
	CategoriesJSON string
	// A kept draft's choices.
	Type           string
	CategoryID     int64
	CategoryUnsure bool
	// Where the window opens: "home" (the default), "new" (the ticket form)
	// or "ticket" (StartTicket, one of the person's own).
	Start       string
	StartTicket int64
	// The home as JSON (ipc.HomeAnswer) and what the person has already
	// seen (Seen); "{}" when there is none.
	HomeJSON string
	SeenJSON string
}

// PortalDisplay is the portal address without its scheme, as the mockup
// shows it.
func (p Page) PortalDisplay() string {
	return strings.TrimPrefix(strings.TrimPrefix(p.PortalURL, "https://"), "http://")
}

// Render is the window's HTML.
func Render(p Page) (string, error) {
	if p.HelpdeskName == "" {
		p.HelpdeskName = "Help desk"
	}
	if !SafePortalURL(p.PortalURL) {
		p.PortalURL = ""
	}
	if p.CategoriesJSON == "" {
		p.CategoriesJSON = "[]"
	}
	if p.Start != "new" && p.Start != "ticket" {
		p.Start = "home"
	}
	if p.HomeJSON == "" {
		p.HomeJSON = `{"matched":false,"notices":[],"tickets":[],"offline":true}`
	}
	if p.SeenJSON == "" {
		p.SeenJSON = "{}"
	}
	var b bytes.Buffer
	if err := formTmpl.Execute(&b, p); err != nil {
		return "", err
	}
	return b.String(), nil
}

// SafePortalURL: only an https:// address (PRISM builds it from
// PUBLIC_APP_URL) is ever shown or opened.
func SafePortalURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil
}

// TicketURL is a ticket's page in the support portal, or "".
func TicketURL(portal string, ticketID int64) string {
	if !SafePortalURL(portal) || ticketID <= 0 {
		return ""
	}
	return strings.TrimRight(portal, "/") + "/tickets/" + strconv.FormatInt(ticketID, 10)
}

// Draft is a message that couldn't be sent yet.
type Draft struct {
	Subject        string `json:"subject"`
	Description    string `json:"description"`
	Type           string `json:"type,omitempty"`
	CategoryID     int64  `json:"categoryId,omitempty"`
	CategoryUnsure bool   `json:"categoryUnsure,omitempty"`
}

// DraftDir is %LOCALAPPDATA%\PRISM (per user), or the user's config folder
// elsewhere.
func DraftDir() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "PRISM")
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "PRISM")
	}
	return ""
}

func draftPath(dir string) string { return filepath.Join(dir, "draft.json") }

// SaveDraft keeps a message for later (only the user can read it).
func SaveDraft(dir string, d Draft) error {
	if dir == "" {
		return errors.New("no folder for the draft")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return os.WriteFile(draftPath(dir), b, 0o600)
}

// LoadDraft is the kept message, if any.
func LoadDraft(dir string) (Draft, bool) {
	var d Draft
	b, err := os.ReadFile(draftPath(dir))
	if err != nil || json.Unmarshal(b, &d) != nil || strings.TrimSpace(d.Subject+d.Description) == "" {
		return Draft{}, false
	}
	return d, true
}

// ClearDraft forgets it once sent.
func ClearDraft(dir string) { _ = os.Remove(draftPath(dir)) }
