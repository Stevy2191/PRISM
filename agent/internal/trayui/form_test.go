package trayui

import (
	"strings"
	"testing"
)

func TestFormEscapesWhatPRISMSends(t *testing.T) {
	html, err := Render(Page{
		HelpdeskName: `<script>alert("desk")</script>`,
		Name:         "Maria <b>Chen</b>",
		Company:      "Riverside & Co · Front desk",
		Computer:     `"><img src=x onerror=alert(1)>`,
		Subject:      `</textarea><script>alert(2)</script>`,
		PortalURL:    "https://desk.riverside-it.com/portal",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{`<script>alert("desk")`, `<img src=x`, `<b>Chen</b>`, `</textarea><script>alert(2)`} {
		if strings.Contains(html, bad) {
			t.Errorf("unescaped %q in the page", bad)
		}
	}
	for _, good := range []string{"&lt;script&gt;alert(&#34;desk&#34;)&lt;/script&gt;", "&#34;&gt;&lt;img src=x onerror=alert(1)&gt;", "Riverside &amp; Co · Front desk"} {
		if !strings.Contains(html, good) {
			t.Errorf("expected %q in the page", good)
		}
	}
	if !strings.Contains(html, `data-portal="https://desk.riverside-it.com/portal"`) || !strings.Contains(html, "desk.riverside-it.com/portal</dd>") {
		t.Error("the portal address is missing")
	}
	// The page loads nothing from anywhere (CSP).
	if !strings.Contains(html, "default-src 'none'") {
		t.Error("no Content-Security-Policy")
	}
}

func TestOnlyAnHTTPSPortalIsShownOrOpened(t *testing.T) {
	for _, bad := range []string{"javascript:alert(1)", "http://desk.example.com/portal", "file:///C:/Windows", "https://user:pw@desk.example.com", ""} {
		html, _ := Render(Page{PortalURL: bad})
		if strings.Contains(html, `data-portal="`+bad+`"`) && bad != "" {
			t.Errorf("portal %q was kept", bad)
		}
		if TicketURL(bad, 5) != "" {
			t.Errorf("TicketURL(%q) opened", bad)
		}
	}
	if got := TicketURL("https://desk.example.com/portal/", 2418); got != "https://desk.example.com/portal/tickets/2418" {
		t.Errorf("TicketURL = %q", got)
	}
}

func TestOfflineContactsShowOnlyWhatIsKnown(t *testing.T) {
	html, _ := Render(Page{HelpdeskEmail: "help@riverside-it.com"})
	if !strings.Contains(html, "help@riverside-it.com</dd>") || strings.Contains(html, ">Portal<") {
		t.Error("email only: wrong contact list")
	}
	html, _ = Render(Page{})
	if strings.Contains(html, `class="contact"`) || !strings.Contains(html, "back online.") {
		t.Error("nothing known: there should be no contact list")
	}
}

func TestDraftIsKeptUntilSent(t *testing.T) {
	dir := t.TempDir()
	if _, ok := LoadDraft(dir); ok {
		t.Fatal("a draft before any was saved")
	}
	if err := SaveDraft(dir, Draft{Subject: "Printer offline", Description: "Front desk"}); err != nil {
		t.Fatal(err)
	}
	d, ok := LoadDraft(dir)
	if !ok || d.Subject != "Printer offline" || d.Description != "Front desk" {
		t.Fatalf("draft %+v %v", d, ok)
	}
	// The kept text is put back in the form.
	html, _ := Render(Page{Subject: d.Subject, Description: d.Description})
	if !strings.Contains(html, `value="Printer offline"`) || !strings.Contains(html, ">Front desk</textarea>") {
		t.Error("the draft isn't in the form")
	}
	ClearDraft(dir)
	if _, ok := LoadDraft(dir); ok {
		t.Fatal("the draft outlived the sent ticket")
	}
}

func TestFormCarriesTheCategoriesAndADraftsChoices(t *testing.T) {
	html, err := Render(Page{
		Name: "Maria", Computer: "RFC-FD-01",
		CategoriesJSON: `[{"id":1,"parentId":null,"name":"Net\"><script>alert(1)</script>","requireChild":false}]`,
		Type:           "incident", CategoryID: 1, CategoryUnsure: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, `"><script>alert(1)`) {
		t.Error("a category name escaped the attribute")
	}
	for _, want := range []string{`data-cats="[{&#34;id&#34;:1`, `data-type="incident"`, `data-cat="1"`, `data-unsure="true"`,
		`Ticket type`, `value="incident"`, `value="request"`, "What's an incident?", "Nothing is broken; you need something", `"Other / I'm not sure"`} {
		if !strings.Contains(html, want) {
			t.Errorf("expected %q in the page", want)
		}
	}
	// No categories (offline, an older PRISM): an empty list, so no step.
	empty, _ := Render(Page{Name: "Maria", Computer: "RFC-FD-01"})
	if !strings.Contains(empty, `data-cats="[]"`) {
		t.Error("no empty category list")
	}
}
