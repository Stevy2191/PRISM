package trayui

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

// Seen is what this person has already looked at in the window: the
// notices shown to them and the newest help-desk reply read on each ticket.
// The tray's icon carries a dot while the home has anything not in here
// (owner, 2026-11-13: something has to stay after a pop-up is gone).
type Seen struct {
	Notices []int64          `json:"notices"`
	Replies map[string]int64 `json:"replies"`
}

func seenPath(dir string) string { return filepath.Join(dir, "seen.json") }

// LoadSeen is the kept record; empty when there is none.
func LoadSeen(dir string) Seen {
	s := Seen{}
	if b, err := os.ReadFile(seenPath(dir)); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	if s.Replies == nil {
		s.Replies = map[string]int64{}
	}
	return s
}

// ParseSeen reads what the window sends back, bounded: at most 200 notices
// and 200 tickets, so the file can't grow without limit.
func ParseSeen(raw string) (Seen, error) {
	if len(raw) > 64<<10 {
		return Seen{}, errors.New("too large")
	}
	var s Seen
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return Seen{}, err
	}
	if len(s.Notices) > 200 {
		s.Notices = s.Notices[len(s.Notices)-200:]
	}
	if len(s.Replies) > 200 {
		return Seen{}, errors.New("too many tickets")
	}
	if s.Replies == nil {
		s.Replies = map[string]int64{}
	}
	return s, nil
}

// SaveSeen keeps it in the user's own folder.
func SaveSeen(dir string, s Seen) error {
	if dir == "" {
		return errors.New("no folder")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return os.WriteFile(seenPath(dir), b, 0o600)
}

// NewNotice: this notice hasn't been shown to the person yet.
func (s Seen) NewNotice(id int64) bool {
	for _, n := range s.Notices {
		if n == id {
			return false
		}
	}
	return true
}

// NewReply: the ticket's newest help-desk reply hasn't been read yet.
func (s Seen) NewReply(ticketID, replyID int64) bool {
	return replyID > 0 && s.Replies[strconv.FormatInt(ticketID, 10)] < replyID
}

// Shorten cuts a title for a menu line, on a rune boundary.
func Shorten(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
