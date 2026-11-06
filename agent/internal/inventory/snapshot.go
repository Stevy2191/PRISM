package inventory

import (
	"time"
)

// Snapshot is the health snapshot sent with a tray ticket (the backend
// makes it a private note: services/agent/trayTickets.js snapshotNote). The
// service collects it itself when the ticket is raised; the tray can't add
// to it or change it.
type Snapshot struct {
	OS           SnapOS     `json:"os"`
	UptimeSec    int64      `json:"uptimeSec,omitempty"`
	Memory       *SnapMem   `json:"memory,omitempty"`
	Disks        []SnapDisk `json:"disks"`
	SignedInUser string     `json:"signedInUser,omitempty"`
	Domain       string     `json:"domain,omitempty"`
	Directory    string     `json:"directory,omitempty"` // macOS directory binding (8b)
	Realm        string     `json:"realm,omitempty"`     // Linux realm (8c)
	IPAddresses  []string   `json:"ipAddresses"`
	AgentVersion string     `json:"agentVersion"`
	TakenAt      string     `json:"takenAt"`
}

type SnapOS struct {
	Name    string `json:"name,omitempty"`
	Version string `json:"version,omitempty"`
	Build   string `json:"build,omitempty"`
}

type SnapMem struct {
	UsedBytes  uint64 `json:"usedBytes"`
	TotalBytes uint64 `json:"totalBytes"`
}

type SnapDisk struct {
	Name      string `json:"name"`
	FreeBytes uint64 `json:"freeBytes"`
	SizeBytes uint64 `json:"sizeBytes"`
}

// SnapRaw is what a platform read for a snapshot.
type SnapRaw struct {
	OSCaption, OSDisplayVersion, OSBuild, OSUBR string
	LastBoot                                    time.Time
	MemTotal, MemFree                           uint64
	Disks                                       []RawDisk
	Adapters                                    []RawAdapter
	PrimaryIP                                   string
	Domain                                      string
	// The directory a Mac is bound to ("Active Directory: riverside.local").
	Directory string
	// The realm a Linux computer has joined ("Active Directory: riverside.local").
	Realm string
}

// BuildSnapshot turns what was read into the snapshot; account is the user
// who raised the ticket (from the pipe's token), now the time it's taken.
func BuildSnapshot(r SnapRaw, account, agentVersion string, now time.Time) Snapshot {
	s := Snapshot{
		OS:           SnapOS{Name: edition(r.OSCaption), Version: tidy(r.OSDisplayVersion), Build: tidy(r.OSBuild)},
		Disks:        []SnapDisk{},
		SignedInUser: account,
		Domain:       tidy(r.Domain),
		Directory:    tidy(r.Directory),
		Realm:        tidy(r.Realm),
		IPAddresses:  []string{},
		AgentVersion: agentVersion,
		// The computer's own clock, with its offset from UTC, so the help
		// desk can show the time in its zone and the computer's.
		TakenAt: now.Format(time.RFC3339),
	}
	if s.OS.Build != "" && tidy(r.OSUBR) != "" {
		s.OS.Build += "." + tidy(r.OSUBR)
	}
	if !r.LastBoot.IsZero() && now.After(r.LastBoot) {
		s.UptimeSec = int64(now.Sub(r.LastBoot) / time.Second)
	}
	if r.MemTotal > 0 && r.MemFree <= r.MemTotal {
		s.Memory = &SnapMem{UsedBytes: r.MemTotal - r.MemFree, TotalBytes: r.MemTotal}
	}
	for _, d := range Assemble(Raw{Disks: r.Disks}).Disks {
		s.Disks = append(s.Disks, SnapDisk{Name: d.Name, FreeBytes: d.FreeBytes, SizeBytes: d.SizeBytes})
	}
	for _, a := range adapters(r.Adapters, r.PrimaryIP) {
		if a.Primary {
			// The address the help desk most likely wants first.
			s.IPAddresses = append(append([]string{}, a.IPv4...), s.IPAddresses...)
			continue
		}
		s.IPAddresses = append(s.IPAddresses, a.IPv4...)
	}
	return s
}
