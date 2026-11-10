package ipc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stevy2191/prism/agent/internal/client"
)

type call struct {
	method, path string
	body         map[string]any
}

// A fake PRISM: records calls, answers with fn.
type fakePrism struct {
	calls []call
	fn    func(path string) (any, error)
}

func (f *fakePrism) Do(_ context.Context, method, path string, in, out any) (int, error) {
	c := call{method: method, path: path}
	if in != nil {
		b, _ := json.Marshal(in)
		_ = json.Unmarshal(b, &c.body)
	}
	f.calls = append(f.calls, c)
	ans, err := f.fn(path)
	if err != nil {
		return 0, err
	}
	b, _ := json.Marshal(ans)
	_ = json.Unmarshal(b, out)
	return 200, nil
}

var maria = Identity{Account: `RIVERSIDE\mchen`, UPN: "maria.chen@riversideclinic.org"}

func TestSubmitUsesTheTokensIdentityNotTheMessages(t *testing.T) {
	p := &fakePrism{fn: func(string) (any, error) {
		return map[string]any{"ticketId": 2418, "number": "02418", "replyTo": "maria.chen@riversideclinic.org"}, nil
	}}
	s := &Server{PRISM: p, Snapshot: func(account string) any { return map[string]any{"signedInUser": account, "agentVersion": "0.6.0"} }}
	line := []byte(`{"op":"submit","subject":"Scanner missing","description":"Since this morning","account":"RIVERSIDE\\boss","upn":"boss@riversideclinic.org","snapshot":{"agentVersion":"forged"}}`)
	a := s.Handle(context.Background(), maria, line).(SubmitAnswer)
	if a.Number != "02418" || a.ReplyTo != "maria.chen@riversideclinic.org" || a.Error != "" {
		t.Fatalf("answer %+v", a)
	}
	body := p.calls[0].body
	if p.calls[0].path != "/api/v1/agent/v1/tray/tickets" || body["account"] != `RIVERSIDE\mchen` || body["upn"] != "maria.chen@riversideclinic.org" {
		t.Fatalf("sent %+v", p.calls[0])
	}
	if snap := body["snapshot"].(map[string]any); snap["agentVersion"] != "0.6.0" || snap["signedInUser"] != `RIVERSIDE\mchen` {
		t.Fatalf("snapshot came from the tray: %+v", snap)
	}
}

func TestSubmitNeedsASubject(t *testing.T) {
	p := &fakePrism{fn: func(string) (any, error) { return nil, nil }}
	s := &Server{PRISM: p}
	a := s.Handle(context.Background(), maria, []byte(`{"op":"submit","subject":"   "}`)).(SubmitAnswer)
	if a.Error != "invalid" || len(p.calls) != 0 {
		t.Fatalf("answer %+v after %d calls", a, len(p.calls))
	}
	a = s.Handle(context.Background(), maria, []byte(`{"op":"submit","subject":"`+strings.Repeat("x", 300)+`"}`)).(SubmitAnswer)
	if a.Error != "invalid" {
		t.Fatalf("a 300-character subject: %+v", a)
	}
}

func TestOfflineAndRefusedAnswers(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want string
	}{
		{errors.New("dial tcp: no route to host"), "offline"},
		{&client.Error{Status: http.StatusBadGateway}, "offline"},
		{&client.Error{Status: http.StatusTooManyRequests}, "refused"},
		{&client.Error{Status: http.StatusUnauthorized, Code: "AGENT_UNAUTHORIZED"}, "refused"},
		{&client.Error{Status: http.StatusBadRequest, Message: "A subject is required"}, "invalid"},
	} {
		s := &Server{PRISM: &fakePrism{fn: func(string) (any, error) { return nil, tc.err }}}
		a := s.Handle(context.Background(), maria, []byte(`{"op":"submit","subject":"Printer"}`)).(SubmitAnswer)
		if a.Error != tc.want {
			t.Errorf("%v → %q, want %q", tc.err, a.Error, tc.want)
		}
	}
	// Not enrolled yet: offline, nothing sent.
	a := (&Server{}).Handle(context.Background(), maria, []byte(`{"op":"submit","subject":"Printer"}`)).(SubmitAnswer)
	if a.Error != "offline" {
		t.Fatalf("not enrolled: %+v", a)
	}
}

func TestWhoamiPassesTheIdentityAndRemembersTheHelpdesk(t *testing.T) {
	dir := t.TempDir()
	online := true
	p := &fakePrism{fn: func(string) (any, error) {
		if !online {
			return nil, errors.New("offline")
		}
		return WhoamiAnswer{Name: "Maria Chen", Company: "Riverside Family Clinic", Computer: "RFC-FD-01",
			Helpdesk: Helpdesk{Name: "Riverside IT help desk", Email: "help@riverside-it.com", PortalURL: "https://desk.riverside-it.com/portal"}}, nil
	}}
	s := &Server{PRISM: p, CacheDir: dir}
	a := s.Handle(context.Background(), maria, []byte(`{"op":"whoami","account":"RIVERSIDE\\boss"}`)).(WhoamiAnswer)
	if a.Name != "Maria Chen" || a.Offline {
		t.Fatalf("answer %+v", a)
	}
	if want := "/api/v1/agent/v1/tray/whoami?account=RIVERSIDE%5Cmchen&upn=maria.chen%40riversideclinic.org"; p.calls[0].path != want {
		t.Fatalf("asked %s, want %s", p.calls[0].path, want)
	}
	// PRISM unreachable: the last help desk details, marked offline.
	online = false
	a = s.Handle(context.Background(), maria, []byte(`{"op":"whoami"}`)).(WhoamiAnswer)
	if !a.Offline || a.Helpdesk.Email != "help@riverside-it.com" || a.Name != `RIVERSIDE\mchen` || a.Computer == "" {
		t.Fatalf("offline answer %+v", a)
	}
}

func TestGarbageIsRefused(t *testing.T) {
	s := &Server{}
	for _, line := range []string{"not json", `{"op":"format c:"}`, strings.Repeat("x", MaxRequest+1)} {
		if a, ok := s.Handle(context.Background(), maria, []byte(line)).(SubmitAnswer); !ok || a.Error != "invalid" {
			t.Errorf("%.20q → %+v", line, a)
		}
	}
}

// A PRISM that hangs: whoami stops waiting and answers offline, inside the
// tray's own time (on Windows the tray used to be cut off first).
type hangingPrism struct{}

func (hangingPrism) Do(ctx context.Context, _, _ string, _, _ any) (int, error) {
	<-ctx.Done()
	return 0, ctx.Err()
}

func TestWhoamiDoesNotWaitForeverOnPRISM(t *testing.T) {
	saved := WhoamiWait
	WhoamiWait = 50 * time.Millisecond
	defer func() { WhoamiWait = saved }()
	s := &Server{PRISM: hangingPrism{}, CacheDir: t.TempDir()}
	start := time.Now()
	a := s.Handle(context.Background(), maria, []byte(`{"op":"whoami"}`)).(WhoamiAnswer)
	if !a.Offline || time.Since(start) > 2*time.Second {
		t.Fatalf("answer %+v after %v", a, time.Since(start))
	}
	if WhoamiWait >= 30*time.Second || saved >= 30*time.Second {
		t.Fatal("whoami must answer inside the tray's 30 seconds")
	}
}

func TestSubmitCarriesTheTypeAndCategory(t *testing.T) {
	p := &fakePrism{fn: func(string) (any, error) { return map[string]any{"ticketId": 7, "number": "00007"}, nil }}
	s := &Server{PRISM: p}
	s.Handle(context.Background(), maria, []byte(`{"op":"submit","subject":"Wifi","type":"incident","categoryId":42,"categoryUnsure":true}`))
	body := p.calls[0].body
	if body["type"] != "incident" || body["categoryId"] != float64(42) || body["categoryUnsure"] != true {
		t.Fatalf("sent %+v", body)
	}
	// An unknown type, no category and sure: none of them is sent.
	s.Handle(context.Background(), maria, []byte(`{"op":"submit","subject":"Wifi","type":"change","categoryId":0}`))
	body = p.calls[1].body
	for _, k := range []string{"type", "categoryId", "categoryUnsure"} {
		if _, ok := body[k]; ok {
			t.Errorf("%s was sent: %+v", k, body)
		}
	}
}

func TestWhoamiPassesTheCompanysCategories(t *testing.T) {
	p := &fakePrism{fn: func(string) (any, error) {
		return map[string]any{"name": "Maria Chen", "categories": []map[string]any{
			{"id": 1, "parentId": nil, "name": "Network", "requireChild": true},
			{"id": 2, "parentId": 1, "name": "Wireless"},
		}}, nil
	}}
	s := &Server{PRISM: p}
	a := s.Handle(context.Background(), maria, []byte(`{"op":"whoami"}`)).(WhoamiAnswer)
	if len(a.Categories) != 2 || a.Categories[0].Name != "Network" || !a.Categories[0].RequireChild || a.Categories[1].ParentID == nil || *a.Categories[1].ParentID != 1 {
		t.Fatalf("categories %+v", a.Categories)
	}
}
