package ipc

import (
	"fmt"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// The tray runs as an ordinary signed-in user (an administrator's token is
// filtered until elevated), so the pipe's Interactive Users entry is all it
// gets. It must ask for nothing beyond that entry, or Windows refuses it
// outright; the round-trip tests can't see this, since CI runs elevated and
// Administrators have full control (owner, 2026-11-05).
func TestTheTrayAsksOnlyForWhatSignedInUsersHave(t *testing.T) {
	if !strings.Contains(pipeSDDL, fmt.Sprintf("(A;;0x%x;;;IU)", interactiveMask)) {
		t.Fatalf("pipeSDDL %s doesn't give IU interactiveMask 0x%x", pipeSDDL, interactiveMask)
	}
	if extra := uint32(clientAccess) &^ uint32(interactiveMask); extra != 0 {
		t.Fatalf("the tray asks for 0x%x beyond what signed-in users have", extra)
	}
	// And what it needs: talk, and check who owns the pipe.
	for name, right := range map[string]uint32{"read": windows.FILE_READ_DATA, "write": windows.FILE_WRITE_DATA, "owner": windows.READ_CONTROL} {
		if uint32(clientAccess)&right == 0 {
			t.Errorf("the tray can't %s", name)
		}
	}
	// Never the right to make pipe instances (FILE_APPEND_DATA on a pipe),
	// which would let a user stand in for the service.
	if uint32(clientAccess)&windows.FILE_APPEND_DATA != 0 || uint32(interactiveMask)&windows.FILE_APPEND_DATA != 0 {
		t.Fatal("signed-in users must not be able to create pipe instances")
	}
}
