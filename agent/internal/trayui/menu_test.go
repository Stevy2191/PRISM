package trayui

import "testing"

func TestMenuTicketsHeading(t *testing.T) {
	for _, c := range []struct {
		shown, total int
		want         string
	}{
		{0, 0, "No open tickets"},
		{2, 2, "My open tickets"},
		{3, 3, "My open tickets"},
		{3, 7, "My open tickets (3 of 7)"},
	} {
		if got := MenuTicketsHeading(c.shown, c.total); got != c.want {
			t.Errorf("MenuTicketsHeading(%d, %d) = %q, want %q", c.shown, c.total, got, c.want)
		}
	}
}

func TestMenuTicketLine(t *testing.T) {
	if got := MenuTicketLine("Computer issues", "Open", false); got != "    Computer issues  (Open)" {
		t.Errorf("plain line = %q", got)
	}
	if got := MenuTicketLine("Computer issues", "Needs your answer", true); got != " ●  Computer issues  (Needs your answer)" {
		t.Errorf("unread line = %q", got)
	}
	long := MenuTicketLine("A very long ticket title that goes on and on and on", "Open", false)
	if len([]rune(long)) > 4+34+len("  (Open)") {
		t.Errorf("long line not shortened: %q", long)
	}
	if got := MenuTicketLine("No state", "", false); got != "    No state" {
		t.Errorf("no state = %q", got)
	}
}
