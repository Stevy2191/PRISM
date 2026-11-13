// Package ipc connects the tray (one per signed-in user, no rights) to the
// service (SYSTEM, holds the device key). The tray never talks to PRISM.
//
// One request per connection, as one JSON line each way:
//
//	{"op":"whoami"}                                → WhoamiAnswer
//	{"op":"submit","subject":…,"description":…,     → SubmitAnswer
//	 "type":"incident|request","categoryId":…,"categoryUnsure":…}
//	{"op":"home"}                                  → HomeAnswer
//	{"op":"ticket","ticketId":…}                   → TicketAnswer
//	{"op":"reply","ticketId":…,"body":…}           → ReplyAnswer
//
// Who is asking comes from the operating system (the pipe client's token on
// Windows), never from the message: a request's own "account", "upn" or
// "snapshot" fields are ignored, and the service collects the health
// snapshot itself.
package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/stevy2191/prism/agent/internal/client"
)

// MaxRequest is the longest request line the service reads: room for the
// form's attachments (MaxAttachTotal, base64 in JSON) and the text.
const MaxRequest = 32 << 20

// Attachments from the form (owner, 2026-11-11): at most MaxAttachFiles,
// each at most MaxAttachFile bytes and MaxAttachTotal together. PRISM checks
// each again (type, content, size, virus scan).
const (
	MaxAttachFiles = 5
	MaxAttachFile  = 10 << 20
	MaxAttachTotal = 20 << 20
)

// AnswerWait is how long the service gives one request's answer (PRISM may
// be slow; attachments take a while on a slow link).
const AnswerWait = 6 * time.Minute

// ReadRequest reads one request line, at most MaxRequest bytes (more is
// cut there and then refused by Handle). It grows with what arrives rather
// than reserving MaxRequest for every caller.
func ReadRequest(r io.Reader) ([]byte, error) {
	line, err := bufio.NewReader(io.LimitReader(r, MaxRequest+1)).ReadBytes('\n')
	if len(line) > 0 {
		return line, nil
	}
	return nil, err
}

// Identity is the pipe client's user, from the OS.
type Identity struct {
	Account string // DOMAIN\user
	UPN     string
}

// Request is what the tray may send. Nothing else is read.
type Request struct {
	Op          string `json:"op"`
	Subject     string `json:"subject"`
	Description string `json:"description"`
	// The form's choices (sub-project 9). PRISM checks the category against
	// this computer's company; nothing here is trusted.
	Type           string `json:"type"`
	CategoryID     int64  `json:"categoryId"`
	CategoryUnsure bool   `json:"categoryUnsure"`
	// Files and screenshots the person added (sent after the ticket).
	Attachments []Attachment `json:"attachments,omitempty"`
	// One of the person's own tickets from this computer, and a reply to it.
	TicketID int64  `json:"ticketId"`
	Body     string `json:"body"`
}

// Notice is a help-desk notice for this computer's company.
type Notice struct {
	ID       int64  `json:"id"`
	Headline string `json:"headline"`
	Message  string `json:"message"`
	PostedAt string `json:"postedAt"`
}

// LastReply is the newest answer from the help desk on a ticket.
type LastReply struct {
	ID      int64  `json:"id"`
	From    string `json:"from"`
	Snippet string `json:"snippet"`
	At      string `json:"at"`
}

// HomeTicket is one of the person's tickets from this computer. State is
// open, needs_answer, on_hold or done.
type HomeTicket struct {
	ID        int64      `json:"id"`
	Number    string     `json:"number"`
	Title     string     `json:"title"`
	State     string     `json:"state"`
	UpdatedAt string     `json:"updatedAt"`
	LastReply *LastReply `json:"lastReply"`
}

// HomeAnswer is the window's home and the tray's menu. Matched: the signed-in
// person is one of the company's contacts (only then are there tickets).
type HomeAnswer struct {
	Matched bool         `json:"matched"`
	Notices []Notice     `json:"notices"`
	Tickets []HomeTicket `json:"tickets"`
	Offline bool         `json:"offline"`
}

// Message is one line of a ticket's conversation the person may read.
// Side is support, you or contact.
type Message struct {
	ID   int64  `json:"id"`
	From string `json:"from"`
	Side string `json:"side"`
	Body string `json:"body"`
	At   string `json:"at"`
}

// TicketAnswer is one ticket with its conversation. Error: "offline" or
// "not_found".
type TicketAnswer struct {
	Ticket struct {
		ID          int64  `json:"id"`
		Number      string `json:"number"`
		Title       string `json:"title"`
		Description string `json:"description"`
		State       string `json:"state"`
		CreatedAt   string `json:"createdAt"`
	} `json:"ticket"`
	Messages []Message `json:"messages"`
	Error    string    `json:"error,omitempty"`
}

// ReplyAnswer: Error "offline", "refused" (Message says why) or "invalid".
type ReplyAnswer struct {
	ID      int64  `json:"id,omitempty"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// Attachment is one file from the form: its name, its type as the form
// saw it, and its bytes (base64 in JSON).
type Attachment struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Data []byte `json:"data"`
}

// Category is one of the company's ticket categories, for the form's steps.
type Category struct {
	ID           int64  `json:"id"`
	ParentID     *int64 `json:"parentId"`
	Name         string `json:"name"`
	RequireChild bool   `json:"requireChild"`
	// The ticket type it's for: "incident", "request", or empty for both.
	TicketType string `json:"ticketType,omitempty"`
}

// Helpdesk is how to reach the help desk, from PRISM (Task 5's whoami).
type Helpdesk struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	PortalURL string `json:"portalUrl"`
}

// WhoamiAnswer fills the form. Offline: PRISM can't be reached; the help
// desk details are the last ones PRISM gave.
type WhoamiAnswer struct {
	Name       string   `json:"name"`
	Company    string   `json:"company"`
	Department string   `json:"department"`
	Computer   string   `json:"computer"`
	Helpdesk   Helpdesk `json:"helpdesk"`
	// The company's categories (9); none offline or from an older PRISM.
	Categories []Category `json:"categories,omitempty"`
	Offline    bool       `json:"offline"`
	Error      string     `json:"error,omitempty"`
}

// SubmitAnswer: Number on success; Error "offline" (try again later) or
// "refused" (Message says why), "invalid" (the form's fault).
type SubmitAnswer struct {
	// NotAttached: files the ticket was sent without (PRISM refused them,
	// or the connection dropped), with why, for the "Ticket sent" screen.
	NotAttached []string `json:"notAttached,omitempty"`
	Number      string   `json:"number,omitempty"`
	TicketID    int64    `json:"ticketId,omitempty"`
	ReplyTo     string   `json:"replyTo,omitempty"`
	Error       string   `json:"error,omitempty"`
	Message     string   `json:"message,omitempty"`
}

// Doer is the signed PRISM client (client.Client); tests fake it.
type Doer interface {
	Do(ctx context.Context, method, path string, in, out any) (int, error)
}

// Server answers the tray.
type Server struct {
	PRISM        Doer // nil until enrolled (SetPRISM)
	AgentVersion string
	// Snapshot collects the health snapshot for the asking user.
	Snapshot func(account string) any
	// CacheDir keeps the help desk details for offline answers.
	CacheDir string

	mu sync.Mutex
}

// SetPRISM gives the server its PRISM client once the computer is enrolled.
func (s *Server) SetPRISM(d Doer) {
	s.mu.Lock()
	s.PRISM = d
	s.mu.Unlock()
}

func (s *Server) prism() Doer {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.PRISM
}

// Handle answers one request line from id.
func (s *Server) Handle(ctx context.Context, id Identity, line []byte) any {
	var req Request
	if len(line) > MaxRequest || json.Unmarshal(line, &req) != nil {
		return SubmitAnswer{Error: "invalid", Message: "The request could not be read."}
	}
	switch req.Op {
	case "whoami":
		return s.whoami(ctx, id)
	case "submit":
		return s.submit(ctx, id, req)
	case "home":
		return s.home(ctx, id)
	case "ticket":
		return s.ticket(ctx, id, req.TicketID)
	case "reply":
		return s.reply(ctx, id, req)
	default:
		return SubmitAnswer{Error: "invalid", Message: "Unknown request."}
	}
}

// WhoamiWait is how long whoami waits for PRISM before answering offline:
// well inside the tray's own 30 seconds, so a slow or unreachable PRISM
// shows as "can't reach the help desk", not as no answer at all.
var WhoamiWait = 10 * time.Second

func (s *Server) whoami(ctx context.Context, id Identity) WhoamiAnswer {
	host, _ := os.Hostname()
	if p := s.prism(); p != nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, WhoamiWait)
		defer cancel()
		q := url.Values{"account": {id.Account}}
		if id.UPN != "" {
			q.Set("upn", id.UPN)
		}
		var a WhoamiAnswer
		if _, err := p.Do(ctx, http.MethodGet, "/api/v1/agent/v1/tray/whoami?"+q.Encode(), nil, &a); err == nil {
			s.saveHelpdesk(a.Helpdesk)
			return a
		}
	}
	return WhoamiAnswer{Name: id.Account, Computer: host, Helpdesk: s.loadHelpdesk(), Offline: true}
}

func (s *Server) submit(ctx context.Context, id Identity, req Request) SubmitAnswer {
	subject := strings.TrimSpace(req.Subject)
	if subject == "" {
		return SubmitAnswer{Error: "invalid", Message: "Add a subject."}
	}
	if utf8.RuneCountInString(subject) > 255 || len(req.Description) > 20000 {
		return SubmitAnswer{Error: "invalid", Message: "The subject or description is too long."}
	}
	if msg := checkAttachments(req.Attachments); msg != "" {
		return SubmitAnswer{Error: "invalid", Message: msg}
	}
	p := s.prism()
	if p == nil {
		return SubmitAnswer{Error: "offline"}
	}
	var snap any
	if s.Snapshot != nil {
		snap = s.Snapshot(id.Account)
	}
	body := map[string]any{
		"account": id.Account, "subject": subject, "description": strings.TrimSpace(req.Description), "snapshot": snap,
	}
	// Incident or request (9); anything else isn't sent, and PRISM makes it
	// a request. A category the person chose, or "not sure".
	if req.Type == "incident" || req.Type == "request" {
		body["type"] = req.Type
	}
	if req.CategoryID > 0 {
		body["categoryId"] = req.CategoryID
	}
	if req.CategoryUnsure {
		body["categoryUnsure"] = true
	}
	if id.UPN != "" {
		body["upn"] = id.UPN
	}
	var out struct {
		TicketID int64   `json:"ticketId"`
		Number   string  `json:"number"`
		ReplyTo  *string `json:"replyTo"`
	}
	_, err := p.Do(ctx, http.MethodPost, "/api/v1/agent/v1/tray/tickets", body, &out)
	if err != nil {
		var e *client.Error
		switch {
		case errors.As(err, &e) && e.Status == http.StatusTooManyRequests:
			return SubmitAnswer{Error: "refused", Message: "Too many tickets from this computer. Try again in a while, or contact the help desk another way."}
		case client.Retryable(err):
			return SubmitAnswer{Error: "offline"}
		case errors.As(err, &e) && e.Status == http.StatusBadRequest:
			return SubmitAnswer{Error: "invalid", Message: e.Message}
		default:
			return SubmitAnswer{Error: "refused", Message: "The help desk didn't accept this computer's ticket. Contact the help desk another way."}
		}
	}
	a := SubmitAnswer{Number: out.Number, TicketID: out.TicketID}
	if out.ReplyTo != nil {
		a.ReplyTo = *out.ReplyTo
	}
	// The files, each its own signed request, once the ticket exists. One
	// that doesn't make it never undoes the ticket: the form says which.
	a.NotAttached = s.attach(ctx, p, out.TicketID, req.Attachments)
	return a
}

// BytesDoer sends raw bytes signed (client.Client.DoBytes); a PRISM client
// without it can't attach files.
type BytesDoer interface {
	DoBytes(ctx context.Context, path, contentType string, body []byte, out any) (int, error)
}

func checkAttachments(files []Attachment) string {
	if len(files) > MaxAttachFiles {
		return fmt.Sprintf("Attach at most %d files.", MaxAttachFiles)
	}
	total := 0
	for _, f := range files {
		if len(f.Data) == 0 {
			return "One of the files is empty."
		}
		if len(f.Data) > MaxAttachFile {
			return fmt.Sprintf("%s is larger than %d MB.", attachName(f.Name), MaxAttachFile>>20)
		}
		total += len(f.Data)
	}
	if total > MaxAttachTotal {
		return fmt.Sprintf("The files add up to more than %d MB.", MaxAttachTotal>>20)
	}
	return ""
}

// attachName: the file's own name only, cut to 200 characters.
func attachName(name string) string {
	name = strings.TrimSpace(filepath.Base(strings.ReplaceAll(name, "\\", "/")))
	if name == "" || name == "." || name == "/" {
		name = "attachment"
	}
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200])
	}
	return name
}

func (s *Server) attach(ctx context.Context, p Doer, ticketID int64, files []Attachment) []string {
	if len(files) == 0 {
		return nil
	}
	bd, ok := p.(BytesDoer)
	var failed []string
	for _, f := range files {
		name := attachName(f.Name)
		if !ok || ticketID <= 0 {
			failed = append(failed, name)
			continue
		}
		q := url.Values{"name": {name}}
		if f.Type != "" {
			q.Set("type", f.Type)
		}
		path := fmt.Sprintf("/api/v1/agent/v1/tray/tickets/%d/attachments?%s", ticketID, q.Encode())
		if _, err := bd.DoBytes(ctx, path, "application/octet-stream", f.Data, nil); err != nil {
			var e *client.Error
			if errors.As(err, &e) && e.Message != "" {
				failed = append(failed, name+": "+e.Message)
			} else {
				failed = append(failed, name)
			}
		}
	}
	return failed
}

func (s *Server) cacheFile() string {
	if s.CacheDir == "" {
		return ""
	}
	return filepath.Join(s.CacheDir, "helpdesk.json")
}

func (s *Server) saveHelpdesk(h Helpdesk) {
	f := s.cacheFile()
	if f == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if b, err := json.Marshal(h); err == nil {
		_ = os.WriteFile(f, b, 0o644)
	}
}

func (s *Server) loadHelpdesk() Helpdesk {
	var h Helpdesk
	if f := s.cacheFile(); f != "" {
		if b, err := os.ReadFile(f); err == nil {
			_ = json.Unmarshal(b, &h)
		}
	}
	return h
}

// who is the asking user as PRISM's query string.
func who(id Identity) url.Values {
	q := url.Values{"account": {id.Account}}
	if id.UPN != "" {
		q.Set("upn", id.UPN)
	}
	return q
}

// home: the help desk's notices and the person's tickets from this
// computer. Offline (or not enrolled): nothing, marked offline.
func (s *Server) home(ctx context.Context, id Identity) HomeAnswer {
	empty := HomeAnswer{Notices: []Notice{}, Tickets: []HomeTicket{}, Offline: true}
	p := s.prism()
	if p == nil {
		return empty
	}
	ctx, cancel := context.WithTimeout(ctx, WhoamiWait)
	defer cancel()
	var a HomeAnswer
	if _, err := p.Do(ctx, http.MethodGet, "/api/v1/agent/v1/tray/home?"+who(id).Encode(), nil, &a); err != nil {
		return empty
	}
	if a.Notices == nil {
		a.Notices = []Notice{}
	}
	if a.Tickets == nil {
		a.Tickets = []HomeTicket{}
	}
	return a
}

// ticket: one of the person's tickets with its conversation.
func (s *Server) ticket(ctx context.Context, id Identity, ticketID int64) TicketAnswer {
	if ticketID <= 0 {
		return TicketAnswer{Error: "not_found"}
	}
	p := s.prism()
	if p == nil {
		return TicketAnswer{Error: "offline"}
	}
	ctx, cancel := context.WithTimeout(ctx, WhoamiWait)
	defer cancel()
	var a TicketAnswer
	if _, err := p.Do(ctx, http.MethodGet, fmt.Sprintf("/api/v1/agent/v1/tray/tickets/%d?%s", ticketID, who(id).Encode()), nil, &a); err != nil {
		if client.Retryable(err) {
			return TicketAnswer{Error: "offline"}
		}
		return TicketAnswer{Error: "not_found"}
	}
	if a.Messages == nil {
		a.Messages = []Message{}
	}
	return a
}

// reply: the person's answer on one of their tickets.
func (s *Server) reply(ctx context.Context, id Identity, req Request) ReplyAnswer {
	body := strings.TrimSpace(req.Body)
	if req.TicketID <= 0 || body == "" {
		return ReplyAnswer{Error: "invalid", Message: "Write a reply first."}
	}
	if utf8.RuneCountInString(body) > 10000 {
		return ReplyAnswer{Error: "invalid", Message: "That reply is too long."}
	}
	p := s.prism()
	if p == nil {
		return ReplyAnswer{Error: "offline"}
	}
	in := map[string]any{"account": id.Account, "body": body}
	if id.UPN != "" {
		in["upn"] = id.UPN
	}
	var out struct {
		ID int64 `json:"id"`
	}
	if _, err := p.Do(ctx, http.MethodPost, fmt.Sprintf("/api/v1/agent/v1/tray/tickets/%d/reply", req.TicketID), in, &out); err != nil {
		var e *client.Error
		switch {
		case errors.As(err, &e) && e.Status == http.StatusTooManyRequests:
			return ReplyAnswer{Error: "refused", Message: "Too many replies from this computer. Try again in a while."}
		case client.Retryable(err):
			return ReplyAnswer{Error: "offline"}
		case errors.As(err, &e) && e.Status == http.StatusBadRequest:
			return ReplyAnswer{Error: "invalid", Message: e.Message}
		default:
			return ReplyAnswer{Error: "refused", Message: "The help desk didn't accept the reply. Open the ticket in the support portal instead."}
		}
	}
	return ReplyAnswer{ID: out.ID}
}
