package trayui

import (
	"os"
	"testing"
)

// PRISM_FORM_PREVIEW=<file> writes the window's page with sample data, to
// look at in a browser (a design aid, not a check).
func TestWritePreview(t *testing.T) {
	out := os.Getenv("PRISM_FORM_PREVIEW")
	if out == "" {
		t.Skip("set PRISM_FORM_PREVIEW to write a preview")
	}
	home := `{"matched":true,"offline":false,"notices":[{"id":1,"headline":"Email is slow this morning","message":"We're on it with the provider.","postedAt":"2026-11-22T09:10:00Z"}],` +
		`"tickets":[{"id":12,"number":"RFC-T0012","title":"Printer on 2nd floor offline","state":"needs_answer","updatedAt":"2026-11-22T10:00:00Z","lastReply":{"id":5,"from":"Tina","snippet":"Can you check the cable?","at":"2026-11-22T10:00:00Z"}},` +
		`{"id":9,"number":"RFC-T0009","title":"New starter laptop for Sam","state":"open","updatedAt":"2026-11-20T15:00:00Z","lastReply":null},` +
		`{"id":7,"number":"RFC-T0007","title":"VPN drops every hour","state":"on_hold","updatedAt":"2026-11-18T09:00:00Z","lastReply":null}]}`
	html, err := Render(Page{
		HelpdeskName: "Northwind IT", HelpdeskEmail: "help@northwind.example", PortalURL: "https://desk.northwind.example/portal/riverside",
		Name: "Maria Chen", Company: "Riverside Family Clinic · Front desk", Computer: "RFC-FRONT-01",
		CategoriesJSON: "[]", Start: os.Getenv("PRISM_FORM_START"), HomeJSON: home, SeenJSON: `{"notices":[],"replies":{}}`, CanCapture: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, []byte(html), 0o644); err != nil {
		t.Fatal(err)
	}
}
