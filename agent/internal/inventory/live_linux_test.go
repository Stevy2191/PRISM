package inventory

import (
	"os"
	"testing"
)

// This process's own user, as the tray's socket will see it.
func TestPersonForThisProcess(t *testing.T) {
	u, err := PersonFor(uint32(os.Getuid()))
	if err != nil {
		t.Fatal(err)
	}
	if os.Getuid() == 0 {
		if u != nil {
			t.Fatalf("root became a person: %+v", u)
		}
		return
	}
	if os.Getuid() >= 1000 && (u == nil || u.Account == "") {
		t.Fatal("no account for this user")
	}
	t.Logf("%+v", u)
}

func TestDesktopUserOnThisComputer(t *testing.T) {
	// A CI runner or a container has no graphical session: nobody, no error
	// beyond loginctl being absent.
	u, r, err := desktopUser()
	t.Logf("user %+v, realm %q, err %v", u, r, err)
}
