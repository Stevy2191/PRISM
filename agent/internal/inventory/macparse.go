package inventory

// Parsing for the Mac collector (collect_darwin.go). Plain Go with no build
// tag, so it is tested from captured output on every OS. Everything here
// reads untrusted text (command output, app bundles) and only returns
// values; nothing is ever run from it.

import (
	"bufio"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"howett.net/plist"
)

// MacHardware is what system_profiler's SPHardwareDataType gives.
type MacHardware struct {
	MachineName  string // "MacBook Air"
	MachineModel string // "Mac15,12"
	Chip         string // "Apple M3" (Apple silicon)
	CPUType      string // "Quad-Core Intel Core i7" (Intel)
	Serial       string
	BootROM      string
}

// ParseHardwareJSON reads `system_profiler -json SPHardwareDataType`.
func ParseHardwareJSON(b []byte) (MacHardware, error) {
	var doc struct {
		SPHardwareDataType []struct {
			MachineName  string `json:"machine_name"`
			MachineModel string `json:"machine_model"`
			ChipType     string `json:"chip_type"`
			CPUType      string `json:"cpu_type"`
			SerialNumber string `json:"serial_number"`
			BootROM      string `json:"boot_rom_version"`
		} `json:"SPHardwareDataType"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return MacHardware{}, err
	}
	if len(doc.SPHardwareDataType) == 0 {
		return MacHardware{}, nil
	}
	h := doc.SPHardwareDataType[0]
	return MacHardware{
		MachineName: tidy(h.MachineName), MachineModel: tidy(h.MachineModel), Chip: tidy(h.ChipType),
		CPUType: tidy(h.CPUType), Serial: tidy(h.SerialNumber), BootROM: tidy(h.BootROM),
	}, nil
}

var appleChip = regexp.MustCompile(`^Apple (M\d+(?: (?:Pro|Max|Ultra))?)$`)

// MacModel is the model as PRISM shows it: "MacBook Air (M3)" on Apple
// silicon, the plain name ("MacBook Pro") on Intel. The year isn't known
// without Apple's online lookup.
func MacModel(h MacHardware) string {
	name := h.MachineName
	if name == "" {
		name = h.MachineModel
	}
	if m := appleChip.FindStringSubmatch(h.Chip); m != nil && name != "" {
		return name + " (" + m[1] + ")"
	}
	return name
}

// ParseHardwarePorts reads `networksetup -listallhardwareports`: the device
// ("en0") to its name ("Wi-Fi").
func ParseHardwarePorts(text string) map[string]string {
	out := map[string]string{}
	port := ""
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch {
		case strings.HasPrefix(line, "Hardware Port:"):
			port = strings.TrimSpace(strings.TrimPrefix(line, "Hardware Port:"))
		case strings.HasPrefix(line, "Device:") && port != "":
			if dev := strings.TrimSpace(strings.TrimPrefix(line, "Device:")); dev != "" {
				out[dev] = port
			}
			port = ""
		}
	}
	return out
}

// MacDiskInfo is the part of `diskutil info -plist <mount>` the inventory
// uses.
type MacDiskInfo struct {
	VolumeName   string `plist:"VolumeName"`
	Internal     bool   `plist:"Internal"`
	Removable    bool   `plist:"RemovableMedia"`
	Ejectable    bool   `plist:"Ejectable"`
	BusProtocol  string `plist:"BusProtocol"`
	SolidState   bool   `plist:"SolidState"`
	FilesystemID string `plist:"FilesystemType"`
}

// ParseDiskutilInfo reads `diskutil info -plist`.
func ParseDiskutilInfo(b []byte) (MacDiskInfo, error) {
	var d MacDiskInfo
	_, err := plist.Unmarshal(b, &d)
	return d, err
}

// MacMount is one mounted file system (getfsstat).
type MacMount struct {
	Path   string // mount point
	FSType string // "apfs", "exfat", "msdos", "hfs", "nfs", "smbfs"…
	Local  bool   // MNT_LOCAL
	Size   uint64
	Free   uint64 // available to users
}

// macSkip: system volumes of the boot disk (the sealed system, Preboot, VM,
// Update…) share its space with the data volume, which is the one counted.
func macSkip(p string) bool {
	if p == "/" {
		return true
	}
	if strings.HasPrefix(p, "/System/Volumes/") && p != "/System/Volumes/Data" {
		return true
	}
	return strings.HasPrefix(p, "/private/") || strings.HasPrefix(p, "/dev") || strings.HasPrefix(p, "/Library/Developer/CoreSimulator")
}

var diskFS = map[string]bool{"apfs": true, "hfs": true, "exfat": true, "msdos": true, "ntfs": true}

// MacDisks turns mounts (and diskutil's word on each) into RawDisks: the
// data volume as the internal disk, and every other local disk under
// /Volumes, marked external (USB, Thunderbolt) or removable (SD cards).
// Network shares, disk images' system volumes and the boot disk's system
// volumes are left out.
func MacDisks(mounts []MacMount, info func(path string) (MacDiskInfo, bool)) []RawDisk {
	out := []RawDisk{}
	for _, m := range mounts {
		if !m.Local || !diskFS[m.FSType] || m.Size == 0 || macSkip(m.Path) {
			continue
		}
		if m.Path != "/System/Volumes/Data" && !strings.HasPrefix(m.Path, "/Volumes/") {
			continue
		}
		d := RawDisk{DriveType: 3, Size: m.Size, Free: m.Free}
		di, ok := info(m.Path)
		switch {
		case m.Path == "/System/Volumes/Data":
			d.Name = "Macintosh HD"
			if ok && di.VolumeName != "" {
				d.Name = strings.TrimSuffix(di.VolumeName, " - Data")
			}
		default:
			d.Name = strings.TrimPrefix(m.Path, "/Volumes/")
			if ok && strings.EqualFold(di.BusProtocol, "Disk Image") {
				continue // a mounted .dmg isn't a disk of this computer
			}
			if ok {
				switch {
				case di.Removable && di.Internal:
					d.DriveType = 2 // the built-in SD card slot
				case !di.Internal && strings.EqualFold(di.BusProtocol, "USB"):
					d.Interface = "USB"
				case !di.Internal:
					d.Interface = "External"
				}
			} else {
				d.Interface = "External"
			}
		}
		out = append(out, d)
	}
	return out
}

// macInfoPlist is the part of an app's Contents/Info.plist the list uses.
type macInfoPlist struct {
	Name        string `plist:"CFBundleName"`
	DisplayName string `plist:"CFBundleDisplayName"`
	Short       string `plist:"CFBundleShortVersionString"`
	Version     string `plist:"CFBundleVersion"`
	ID          string `plist:"CFBundleIdentifier"`
	Copyright   string `plist:"NSHumanReadableCopyright"`
}

var (
	copyrightNoise = regexp.MustCompile(`(?i)(copyright|\(c\)|©|all rights reserved\.?|\b(19|20)\d\d\s*[-–,]?\s*((19|20)\d\d)?\b)`)
	copyrightTail  = regexp.MustCompile(`[\s.,;:]+$`)
)

// publisher: the company in the copyright line ("Copyright © 2024 Google LLC.
// All rights reserved." → "Google LLC"), else the vendor part of the bundle
// identifier ("com.zoom.xos" → "Zoom").
func publisher(copyright, bundleID string) string {
	c := copyrightNoise.ReplaceAllString(copyright, " ")
	c = copyrightTail.ReplaceAllString(tidy(c), "")
	c = strings.TrimLeft(c, " .,;:")
	if c != "" && len(c) <= 80 {
		return c
	}
	parts := strings.Split(bundleID, ".")
	if len(parts) >= 2 && parts[1] != "" {
		v := parts[1]
		return strings.ToUpper(v[:1]) + v[1:]
	}
	return ""
}

// ParseAppInfoPlist reads an app bundle's Info.plist (XML or binary) into a
// software row; fallbackName is the bundle's folder name without ".app".
func ParseAppInfoPlist(b []byte, fallbackName string, modified time.Time) (RawSoftware, bool) {
	var p macInfoPlist
	if _, err := plist.Unmarshal(b, &p); err != nil {
		return RawSoftware{}, false
	}
	name := p.DisplayName
	if name == "" {
		name = p.Name
	}
	if name == "" {
		name = fallbackName
	}
	version := p.Short
	if version == "" {
		version = p.Version
	}
	s := RawSoftware{Name: name, Version: version, Publisher: publisher(p.Copyright, p.ID)}
	if !modified.IsZero() {
		s.InstallDate = modified.UTC().Format("2006-01-02")
	}
	return s, tidy(s.Name) != ""
}
