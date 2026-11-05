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

// The real collector on this computer (a CI runner or a developer's
// machine): a distribution, memory, a disk and some software.
func TestCollectOnThisComputer(t *testing.T) {
	inv, problems := Collect()
	for _, p := range problems {
		t.Logf("problem: %v", p)
	}
	if inv.OS.Name == "" || inv.OS.Name == "linux" {
		t.Errorf("no distribution: %+v", inv.OS)
	}
	if inv.MemoryBytes == 0 || inv.CPU.Cores == 0 {
		t.Errorf("memory %d, cores %d", inv.MemoryBytes, inv.CPU.Cores)
	}
	if len(inv.Disks) == 0 {
		t.Error("no disk")
	}
	if len(inv.Software) == 0 {
		t.Error("no software")
	}
	t.Logf("%s %s (%s), %s %d cores, %d disks, %d programs, %d adapters", inv.OS.Name, inv.OS.Version, inv.OS.Build, inv.CPU.Model, inv.CPU.Cores, len(inv.Disks), len(inv.Software), len(inv.Adapters))
}

// The snapshot on this computer: the distribution, memory and a disk.
func TestSnapshotOnThisComputer(t *testing.T) {
	s := CollectSnapshot("tester", "0.0.0-test")
	if s.OS.Name == "" || s.Memory == nil || len(s.Disks) == 0 || s.TakenAt == "" {
		t.Fatalf("snapshot %+v", s)
	}
	t.Logf("%s %s, %d of %d bytes in use, %d disks, realm %q", s.OS.Name, s.OS.Version, s.Memory.UsedBytes, s.Memory.TotalBytes, len(s.Disks), s.Realm)
}
