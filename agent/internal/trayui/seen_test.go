package trayui

import (
	"strings"
	"testing"
)

func TestSeenRoundTripAndNew(t *testing.T) {
	dir := t.TempDir()
	if s := LoadSeen(dir); len(s.Notices) != 0 || s.Replies == nil {
		t.Fatalf("empty: %+v", s)
	}
	s, err := ParseSeen(`{"notices":[3,7],"replies":{"12":40}}`)
	if err != nil {
		t.Fatal(err)
	}
	if err := SaveSeen(dir, s); err != nil {
		t.Fatal(err)
	}
	got := LoadSeen(dir)
	if got.NewNotice(3) || !got.NewNotice(8) {
		t.Fatal("notices")
	}
	if got.NewReply(12, 40) || !got.NewReply(12, 41) || !got.NewReply(99, 1) || got.NewReply(99, 0) {
		t.Fatal("replies")
	}
}

func TestParseSeenIsBounded(t *testing.T) {
	if _, err := ParseSeen("not json"); err == nil {
		t.Fatal("junk accepted")
	}
	if _, err := ParseSeen(`{"notices":[` + strings.Repeat("1,", 40000) + `1]}`); err == nil {
		t.Fatal("oversized accepted")
	}
	many := `{"notices":[` + strings.Repeat("1,", 500) + `2]}`
	s, err := ParseSeen(many)
	if err != nil || len(s.Notices) != 200 || s.Notices[199] != 2 {
		t.Fatalf("not trimmed: %d %v", len(s.Notices), err)
	}
}
