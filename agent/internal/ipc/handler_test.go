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

// A fake PRISM that also takes raw bytes (client.Client.DoBytes).
type fakeBytesPrism struct {
	fakePrism
	files []call
	fail  map[string]error
}

func (f *fakeBytesPrism) DoBytes(_ context.Context, path, contentType string, body []byte, _ any) (int, error) {
	f.files = append(f.files, call{method: contentType, path: path, body: map[string]any{"len": len(body)}})
	for name, err := range f.fail {
		if strings.Contains(path, name) {
			return 0, err
		}
	}
	return 201, nil
}

func TestAttachmentsGoAfterTheTicketAndFailuresAreReported(t *testing.T) {
	p := &fakeBytesPrism{
		fakePrism: fakePrism{fn: func(string) (any, error) { return map[string]any{"ticketId": 2418, "number": "02418"}, nil }},
		fail:      map[string]error{"setup": &client.Error{Status: 400, Message: "File type .exe is not allowed"}},
	}
	s := &Server{PRISM: p}
	req := Request{Op: "submit", Subject: "Blue screen", Attachments: []Attachment{
		{Name: `C:\Users\amy\Pictures\Screenshot 1.png`, Type: "image/png", Data: []byte("\x89PNG....")},
		{Name: "setup.exe", Data: []byte("MZ")},
	}}
	line, _ := json.Marshal(req)
	a := s.Handle(context.Background(), maria, line).(SubmitAnswer)
	if a.Number != "02418" {
		t.Fatalf("answer %+v", a)
	}
	if len(p.files) != 2 || p.files[0].method != "application/octet-stream" ||
		p.files[0].path != "/api/v1/agent/v1/tray/tickets/2418/attachments?name=Screenshot+1.png&type=image%2Fpng" {
		t.Fatalf("files %+v", p.files)
	}
	if len(a.NotAttached) != 1 || a.NotAttached[0] != "setup.exe: File type .exe is not allowed" {
		t.Fatalf("not attached %+v", a.NotAttached)
	}
	// The ticket's own request never carries the files.
	if _, ok := p.calls[0].body["attachments"]; ok {
		t.Fatal("files were sent with the ticket")
	}
}

func TestAttachmentLimits(t *testing.T) {
	big := make([]byte, MaxAttachFile+1)
	six := make([]Attachment, MaxAttachFiles+1)
	for i := range six {
		six[i] = Attachment{Name: "a.txt", Data: []byte("x")}
	}
	for _, files := range [][]Attachment{
		six,
		{{Name: "big.png", Data: big}},
		{{Name: "empty.txt"}},
		{{Name: "a", Data: make([]byte, 9<<20)}, {Name: "b", Data: make([]byte, 9<<20)}, {Name: "c", Data: make([]byte, 3<<20)}},
	} {
		p := &fakeBytesPrism{fakePrism: fakePrism{fn: func(string) (any, error) { return map[string]any{"ticketId": 1, "number": "00001"}, nil }}}
		s := &Server{PRISM: p}
		line, _ := json.Marshal(Request{Op: "submit", Subject: "x", Attachments: files})
		a := s.Handle(context.Background(), maria, line).(SubmitAnswer)
		if a.Error != "invalid" || len(p.calls) != 0 {
			t.Errorf("%d files: %+v after %d calls", len(files), a, len(p.calls))
		}
	}
}

func TestReadRequestGrowsAndStopsAtTheLimit(t *testing.T) {
	big := strings.Repeat("x", 5<<20) + "\n"
	line, err := ReadRequest(strings.NewReader(big + "next"))
	if err != nil || len(line) != len(big) {
		t.Fatalf("%d bytes, %v", len(line), err)
	}
	line, _ = ReadRequest(strings.NewReader(strings.Repeat("y", MaxRequest+50)))
	if len(line) != MaxRequest+1 {
		t.Fatalf("read %d of an endless line", len(line))
	}
	if _, err := ReadRequest(strings.NewReader("")); err == nil {
		t.Fatal("nothing read, no error")
	}
}

func TestHomeTicketAndReplyUseTheTokensIdentity(t *testing.T) {
	p := &fakePrism{fn: func(path string) (any, error) {
		switch {
		case strings.Contains(path, "/tray/home"):
			return map[string]any{"matched": true, "notices": []any{map[string]any{"id": 4, "headline": "Email is slow"}},
				"tickets": []any{map[string]any{"id": 12, "number": "00012", "title": "Wifi", "state": "needs_answer", "lastReply": map[string]any{"id": 40, "from": "Tina"}}}}, nil
		case strings.HasSuffix(path, "/reply"):
			return map[string]any{"id": 77}, nil
		default:
			return map[string]any{"ticket": map[string]any{"id": 12, "title": "Wifi", "state": "open"}, "messages": []any{map[string]any{"id": 40, "side": "support", "body": "Which room?"}}}, nil
		}
	}}
	s := &Server{PRISM: p}
	h := s.Handle(context.Background(), maria, []byte(`{"op":"home","account":"RIVERSIDE\\boss"}`)).(HomeAnswer)
	if !h.Matched || h.Offline || len(h.Notices) != 1 || len(h.Tickets) != 1 || h.Tickets[0].LastReply.ID != 40 {
		t.Fatalf("home %+v", h)
	}
	if !strings.Contains(p.calls[0].path, "account=RIVERSIDE%5Cmchen") || !strings.Contains(p.calls[0].path, "upn=maria.chen%40riversideclinic.org") {
		t.Fatalf("home asked as %s", p.calls[0].path)
	}
	tk := s.Handle(context.Background(), maria, []byte(`{"op":"ticket","ticketId":12}`)).(TicketAnswer)
	if tk.Ticket.ID != 12 || len(tk.Messages) != 1 || tk.Error != "" {
		t.Fatalf("ticket %+v", tk)
	}
	if !strings.HasPrefix(p.calls[1].path, "/api/v1/agent/v1/tray/tickets/12?") {
		t.Fatalf("ticket path %s", p.calls[1].path)
	}
	r := s.Handle(context.Background(), maria, []byte(`{"op":"reply","ticketId":12,"body":"  Room 4  ","account":"RIVERSIDE\\boss","upn":"boss@x.org"}`)).(ReplyAnswer)
	if r.ID != 77 || r.Error != "" {
		t.Fatalf("reply %+v", r)
	}
	c := p.calls[2]
	if c.path != "/api/v1/agent/v1/tray/tickets/12/reply" || c.body["account"] != `RIVERSIDE\mchen` || c.body["upn"] != "maria.chen@riversideclinic.org" || c.body["body"] != "Room 4" {
		t.Fatalf("reply sent %+v", c)
	}
}

func TestHomeTicketAndReplyOfflineAndInvalid(t *testing.T) {
	s := &Server{}
	if h := s.Handle(context.Background(), maria, []byte(`{"op":"home"}`)).(HomeAnswer); !h.Offline || h.Notices == nil || h.Tickets == nil {
		t.Fatalf("home %+v", h)
	}
	if a := s.Handle(context.Background(), maria, []byte(`{"op":"ticket","ticketId":3}`)).(TicketAnswer); a.Error != "offline" {
		t.Fatalf("ticket %+v", a)
	}
	if a := s.Handle(context.Background(), maria, []byte(`{"op":"ticket","ticketId":0}`)).(TicketAnswer); a.Error != "not_found" {
		t.Fatalf("ticket 0 %+v", a)
	}
	if a := s.Handle(context.Background(), maria, []byte(`{"op":"reply","ticketId":3,"body":"   "}`)).(ReplyAnswer); a.Error != "invalid" {
		t.Fatalf("empty reply %+v", a)
	}
	if a := s.Handle(context.Background(), maria, []byte(`{"op":"reply","ticketId":3,"body":"hi"}`)).(ReplyAnswer); a.Error != "offline" {
		t.Fatalf("offline reply %+v", a)
	}
	refuse := &fakePrism{fn: func(string) (any, error) {
		return nil, &client.Error{Status: http.StatusNotFound, Message: "Ticket not found"}
	}}
	s.SetPRISM(refuse)
	if a := s.Handle(context.Background(), maria, []byte(`{"op":"ticket","ticketId":3}`)).(TicketAnswer); a.Error != "not_found" {
		t.Fatalf("404 ticket %+v", a)
	}
	if a := s.Handle(context.Background(), maria, []byte(`{"op":"reply","ticketId":3,"body":"hi"}`)).(ReplyAnswer); a.Error != "refused" {
		t.Fatalf("404 reply %+v", a)
	}
}
