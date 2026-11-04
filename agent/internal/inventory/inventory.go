// Package inventory is what the agent reports about its computer: the
// payload of POST /api/v1/agent/v1/inventory (backend
// services/agent/inventory.js). Each platform fills a Raw from its own
// sources (windows.go: WMI, the registry, Windows APIs); Assemble turns it
// into the payload. Assemble is plain Go, so it is tested with captured
// fixtures on every OS.
package inventory

import (
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Inventory is the payload.
type Inventory struct {
	Hostname     string      `json:"hostname"`
	Make         string      `json:"make,omitempty"`
	Model        string      `json:"model,omitempty"`
	SerialNumber string      `json:"serialNumber,omitempty"`
	Firmware     string      `json:"firmware,omitempty"`
	Domain       string      `json:"domain,omitempty"`
	MemoryBytes  uint64      `json:"memoryBytes,omitempty"`
	CPU          CPU         `json:"cpu"`
	OS           OS          `json:"os"`
	LastBootAt   string      `json:"lastBootAt,omitempty"`
	Disks        []Disk      `json:"disks"`
	Adapters     []Adapter   `json:"adapters"`
	Software     []Software  `json:"software"`
	SignedInUser *SignedUser `json:"signedInUser,omitempty"`
}

type CPU struct {
	Model string `json:"model,omitempty"`
	Cores int    `json:"cores,omitempty"`
}

type OS struct {
	Name    string `json:"name,omitempty"`
	Edition string `json:"edition,omitempty"`
	Version string `json:"version,omitempty"`
	Build   string `json:"build,omitempty"`
}

// Disk.Kind: "fixed", "usb", "external" or "removable". PRISM leaves all but
// fixed out of the Asset's storage figure.
type Disk struct {
	Name      string `json:"name"`
	Label     string `json:"label,omitempty"`
	Kind      string `json:"kind"`
	SizeBytes uint64 `json:"sizeBytes"`
	FreeBytes uint64 `json:"freeBytes"`
}

type Adapter struct {
	Name    string   `json:"name"`
	IPv4    []string `json:"ipv4"`
	MAC     string   `json:"mac,omitempty"`
	Primary bool     `json:"primary"`
}

type Software struct {
	Name        string `json:"name"`
	Version     string `json:"version,omitempty"`
	Publisher   string `json:"publisher,omitempty"`
	InstallDate string `json:"installDate,omitempty"`
}

type SignedUser struct {
	Account string `json:"account"`
	UPN     string `json:"upn,omitempty"`
}

// Raw is what a platform collector read, before tidying.
type Raw struct {
	Hostname     string
	Manufacturer string
	Model        string
	BIOSSerial   string
	BIOSVersion  string
	Domain       string
	// Installed memory (sum of the modules); TotalVisible when unknown.
	MemoryModules []uint64
	TotalVisible  uint64
	CPUs          []RawCPU
	// "Microsoft Windows 11 Pro", "24H2", "26100", "2314"
	OSCaption, OSDisplayVersion, OSBuild, OSUBR string
	LastBoot                                    time.Time
	Disks                                       []RawDisk
	Adapters                                    []RawAdapter
	// The primary IPv4 address: the source address of the default route.
	PrimaryIP string
	Software  []RawSoftware
	User      *SignedUser
}

type RawCPU struct {
	Name  string
	Cores int
}

type RawDisk struct {
	Name, Label string
	// Windows DriveType: 2 removable, 3 local, 4 network, 5 CD. Network and
	// CD drives aren't the computer's storage and are left out.
	DriveType uint32
	// The physical disk's bus ("USB", "SCSI", "IDE"…) when known.
	Interface string
	Size      uint64
	Free      uint64
}

type RawAdapter struct {
	Name  string
	MAC   string
	Addrs []string // CIDR or plain addresses, v4 and v6
	Up    bool
	// Loopback, tunnels and virtual switches are skipped.
	Loopback bool
}

// RawSoftware is one Uninstall registry entry (or another platform's
// equivalent).
type RawSoftware struct {
	Name, Version, Publisher, InstallDate string
	SystemComponent                       bool
	// ParentKeyName or a ReleaseType of an update: an update of another
	// program, not a program.
	IsUpdate bool
}

var (
	spaces    = regexp.MustCompile(`\s+`)
	kbUpdate  = regexp.MustCompile(`(?i)\bKB\d{6,8}\b`)
	junkValue = map[string]bool{"": true, "to be filled by o.e.m.": true, "default string": true, "system serial number": true, "system manufacturer": true, "system product name": true, "none": true, "n/a": true, "0": true}
)

func tidy(s string) string { return strings.TrimSpace(spaces.ReplaceAllString(s, " ")) }

// tidyField drops the placeholder text some makers ship.
func tidyField(s string) string {
	t := tidy(s)
	if junkValue[strings.ToLower(t)] {
		return ""
	}
	return t
}

// Edition: "Microsoft Windows 11 Pro" → "Windows 11 Pro".
func edition(caption string) string {
	return strings.TrimPrefix(tidy(caption), "Microsoft ")
}

// Assemble turns what was read into the payload.
func Assemble(r Raw) Inventory {
	inv := Inventory{
		Hostname:     tidy(r.Hostname),
		Make:         tidyField(r.Manufacturer),
		Model:        tidyField(r.Model),
		SerialNumber: tidyField(r.BIOSSerial),
		Firmware:     tidyField(r.BIOSVersion),
		Domain:       tidy(r.Domain),
		Disks:        []Disk{},
		Adapters:     []Adapter{},
		Software:     []Software{},
		SignedInUser: r.User,
	}
	for _, m := range r.MemoryModules {
		inv.MemoryBytes += m
	}
	if inv.MemoryBytes == 0 {
		inv.MemoryBytes = r.TotalVisible
	}
	if len(r.CPUs) > 0 {
		inv.CPU.Model = tidy(r.CPUs[0].Name)
		for _, c := range r.CPUs {
			inv.CPU.Cores += c.Cores
		}
	}
	inv.OS = OS{Name: tidy(r.OSCaption), Edition: edition(r.OSCaption), Version: tidy(r.OSDisplayVersion), Build: tidy(r.OSBuild)}
	if inv.OS.Build != "" && tidy(r.OSUBR) != "" {
		inv.OS.Build += "." + tidy(r.OSUBR)
	}
	if !r.LastBoot.IsZero() {
		inv.LastBootAt = r.LastBoot.UTC().Format(time.RFC3339)
	}
	for _, d := range r.Disks {
		if d.DriveType != 2 && d.DriveType != 3 {
			continue
		}
		kind := "fixed"
		switch {
		case strings.EqualFold(d.Interface, "USB"):
			kind = "usb"
		case strings.EqualFold(d.Interface, "External"):
			// Thunderbolt and other external buses (Mac).
			kind = "external"
		case d.DriveType == 2:
			kind = "removable"
		}
		inv.Disks = append(inv.Disks, Disk{Name: tidy(d.Name), Label: tidy(d.Label), Kind: kind, SizeBytes: d.Size, FreeBytes: d.Free})
	}
	inv.Adapters = adapters(r.Adapters, r.PrimaryIP)
	inv.Software = software(r.Software)
	return inv
}

func adapters(raw []RawAdapter, primaryIP string) []Adapter {
	out := []Adapter{}
	for _, a := range raw {
		if a.Loopback || !a.Up {
			continue
		}
		mac := strings.ToUpper(strings.ReplaceAll(a.MAC, "-", ":"))
		if mac == "" || mac == "00:00:00:00:00:00" {
			// Tunnels (Teredo, IP-HTTPS…) have no MAC.
			continue
		}
		ad := Adapter{Name: tidy(a.Name), IPv4: []string{}, MAC: mac}
		for _, addr := range a.Addrs {
			ip := net.ParseIP(addr)
			if ip == nil {
				if p, _, err := net.ParseCIDR(addr); err == nil {
					ip = p
				}
			}
			if v4 := ip.To4(); v4 != nil && !v4.IsLinkLocalUnicast() {
				ad.IPv4 = append(ad.IPv4, v4.String())
				if v4.String() == primaryIP {
					ad.Primary = true
				}
			}
		}
		out = append(out, ad)
	}
	return out
}

// software: programs only (no updates, no system components), named, one
// per name and version, sorted by name.
func software(raw []RawSoftware) []Software {
	seen := map[string]bool{}
	out := []Software{}
	for _, s := range raw {
		name := tidy(s.Name)
		if name == "" || s.SystemComponent || s.IsUpdate || kbUpdate.MatchString(name) {
			continue
		}
		version := tidy(s.Version)
		key := strings.ToLower(name) + "\x00" + strings.ToLower(version)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, Software{Name: name, Version: version, Publisher: tidy(s.Publisher), InstallDate: installDate(s.InstallDate)})
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

// installDate keeps a real YYYYMMDD or YYYY-MM-DD date as YYYY-MM-DD; some
// installers write other things (or nothing), which are dropped.
func installDate(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "-", "")
	if len(s) != 8 {
		return ""
	}
	if _, err := strconv.Atoi(s); err != nil {
		return ""
	}
	d := s[:4] + "-" + s[4:6] + "-" + s[6:]
	if t, err := time.Parse("2006-01-02", d); err != nil || t.Format("2006-01-02") != d {
		return ""
	}
	return d
}

// PrimaryIP is the local address the computer would use to reach the
// internet: no packet is sent (UDP "connect" only picks a route).
func PrimaryIP() string {
	c, err := net.Dial("udp4", "192.0.2.1:9") // TEST-NET-1: never answered
	if err != nil {
		return ""
	}
	defer c.Close()
	if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.String()
	}
	return ""
}

// GoAdapters lists network adapters from Go's own view (all platforms).
func GoAdapters() []RawAdapter {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := []RawAdapter{}
	for _, i := range ifs {
		ra := RawAdapter{Name: i.Name, MAC: i.HardwareAddr.String(), Up: i.Flags&net.FlagUp != 0, Loopback: i.Flags&net.FlagLoopback != 0}
		if addrs, err := i.Addrs(); err == nil {
			for _, a := range addrs {
				ra.Addrs = append(ra.Addrs, a.String())
			}
		}
		out = append(out, ra)
	}
	return out
}
