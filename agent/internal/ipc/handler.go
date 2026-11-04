// Package ipc connects the tray (one per signed-in user, no rights) to the
// service (SYSTEM, holds the device key). The tray never talks to PRISM.
//
// One request per connection, as one JSON line each way:
//
//	{"op":"whoami"}                                → WhoamiAnswer
//	{"op":"submit","subject":…,"description":…}    → SubmitAnswer
//
// Who is asking comes from the operating system (the pipe client's token on
// Windows), never from the message: a request's own "account", "upn" or
// "snapshot" fields are ignored, and the service collects the health
// snapshot itself.
package ipc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/stevy2191/prism/agent/internal/client"
)

// MaxRequest is the longest request line the service reads.
const MaxRequest = 64 << 10

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
	Offline    bool     `json:"offline"`
	Error      string   `json:"error,omitempty"`
}

// SubmitAnswer: Number on success; Error "offline" (try again later) or
// "refused" (Message says why), "invalid" (the form's fault).
type SubmitAnswer struct {
	Number   string `json:"number,omitempty"`
	TicketID int64  `json:"ticketId,omitempty"`
	ReplyTo  string `json:"replyTo,omitempty"`
	Error    string `json:"error,omitempty"`
	Message  string `json:"message,omitempty"`
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
	default:
		return SubmitAnswer{Error: "invalid", Message: "Unknown request."}
	}
}

func (s *Server) whoami(ctx context.Context, id Identity) WhoamiAnswer {
	host, _ := os.Hostname()
	if p := s.prism(); p != nil {
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
	return a
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
