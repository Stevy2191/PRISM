package trayui

import "strconv"

// The tray menu's words for the person's tickets (owner, 2026-11-13: the
// menu ran together). The tickets sit under a heading, between lines, each
// one indented with its state in brackets.

// MenuTicketsHeading is the heading over the tickets in the tray menu:
// shown of total open tickets are listed under it.
func MenuTicketsHeading(shown, total int) string {
	switch {
	case total <= 0:
		return "No open tickets"
	case total > shown:
		return "My open tickets (" + strconv.Itoa(shown) + " of " + strconv.Itoa(total) + ")"
	default:
		return "My open tickets"
	}
}

// MenuTicketLine is one ticket in the tray menu. unread: the help desk
// replied and the person hasn't opened it yet.
func MenuTicketLine(title, state string, unread bool) string {
	mark := "    "
	if unread {
		mark = " ●  "
	}
	line := mark + Shorten(title, 34)
	if state != "" {
		line += "  (" + state + ")"
	}
	return line
}
