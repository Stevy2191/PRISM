package inventory

import (
	"encoding/json"
	"testing"
	"time"
)

// The snapshot carries the spec's fields, in the shape the backend's
// snapshotNote reads.
func TestSnapshotFields(t *testing.T) {
	now := time.Date(2026, 11, 4, 14, 2, 0, 0, time.UTC)
	r := loadRaw(t, "windows11-raw.json")
	s := BuildSnapshot(SnapRaw{
		OSCaption: "Microsoft Windows 11 Pro", OSDisplayVersion: "24H2", OSBuild: "26100", OSUBR: "2314",
		LastBoot: now.Add(-(3*24*time.Hour + 4*time.Hour + 5*time.Minute)),
		MemTotal: 16 << 30, MemFree: 5 << 30,
		Disks: r.Disks, Adapters: r.Adapters, PrimaryIP: r.PrimaryIP, Domain: "RIVERSIDE",
	}, `RIVERSIDE\mchen`, "0.6.0", now)

	if s.OS != (SnapOS{Name: "Windows 11 Pro", Version: "24H2", Build: "26100.2314"}) {
		t.Fatalf("os %+v", s.OS)
	}
	if s.UptimeSec != 3*86400+4*3600+5*60 {
		t.Fatalf("uptime %d", s.UptimeSec)
	}
	if s.Memory == nil || s.Memory.UsedBytes != 11<<30 || s.Memory.TotalBytes != 16<<30 {
		t.Fatalf("memory %+v", s.Memory)
	}
	// Every local and removable drive, with its free space; no network share.
	if len(s.Disks) != 3 || s.Disks[0] != (SnapDisk{Name: "C:", FreeBytes: 227633270784, SizeBytes: 511101108224}) {
		t.Fatalf("disks %+v", s.Disks)
	}
	if s.SignedInUser != `RIVERSIDE\mchen` || s.Domain != "RIVERSIDE" || s.AgentVersion != "0.6.0" || s.TakenAt != "2026-11-04T14:02:00Z" {
		t.Fatalf("snapshot %+v", s)
	}
	if len(s.IPAddresses) != 1 || s.IPAddresses[0] != "10.20.1.45" {
		t.Fatalf("ips %v", s.IPAddresses)
	}
	b, _ := json.Marshal(s)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"os", "uptimeSec", "memory", "disks", "signedInUser", "domain", "ipAddresses", "agentVersion", "takenAt"} {
		if _, ok := m[k]; !ok {
			t.Errorf("snapshot JSON has no %q", k)
		}
	}
}

func TestSnapshotWithLittleKnown(t *testing.T) {
	s := BuildSnapshot(SnapRaw{}, "", "dev", time.Now())
	b, _ := json.Marshal(s)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if _, ok := m["disks"].([]any); !ok {
		t.Fatal("disks should be a list")
	}
	if s.Memory != nil || s.UptimeSec != 0 {
		t.Fatalf("made-up values: %+v", s)
	}
}
