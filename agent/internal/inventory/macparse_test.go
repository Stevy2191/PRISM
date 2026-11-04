package inventory

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"howett.net/plist"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestMacHardwareAppleSiliconAndIntel(t *testing.T) {
	m3, err := ParseHardwareJSON(fixture(t, "macos-m3-hardware.json"))
	if err != nil {
		t.Fatal(err)
	}
	if MacModel(m3) != "MacBook Air (M3)" || m3.Serial != "FVFG4P3XQ6LR" || m3.BootROM != "11881.41.5" {
		t.Fatalf("Apple silicon: %+v → %q", m3, MacModel(m3))
	}
	intel, err := ParseHardwareJSON(fixture(t, "macos-intel-hardware.json"))
	if err != nil {
		t.Fatal(err)
	}
	if MacModel(intel) != "MacBook Pro" || intel.Serial != "C02ZW1ABMD6R" {
		t.Fatalf("Intel: %+v → %q", intel, MacModel(intel))
	}
	for chip, want := range map[string]string{"Apple M2 Pro": "Mac mini (M2 Pro)", "Apple M1 Ultra": "Mac mini (M1 Ultra)", "Apple M4 Max": "Mac mini (M4 Max)", "": "Mac mini"} {
		if got := MacModel(MacHardware{MachineName: "Mac mini", Chip: chip}); got != want {
			t.Errorf("MacModel(%q) = %q, want %q", chip, got, want)
		}
	}
}

// What PRISM stores, through the shared Assemble.
func TestMacInventoryThroughAssemble(t *testing.T) {
	h, _ := ParseHardwareJSON(fixture(t, "macos-m3-hardware.json"))
	ports := ParseHardwarePorts(string(fixture(t, "macos-hardwareports.txt")))
	adapters := []RawAdapter{
		{Name: "en0", MAC: "a4:83:e7:2c:5d:91", Addrs: []string{"fe80::1/64", "192.168.1.23/24"}, Up: true},
		{Name: "en7", MAC: "00:e0:4c:68:01:2b", Addrs: []string{"10.20.1.77/24"}, Up: true},
		{Name: "lo0", Addrs: []string{"127.0.0.1/8"}, Up: true, Loopback: true},
		{Name: "utun3", Addrs: []string{"fe80::2/64"}, Up: true},
	}
	for i, a := range adapters {
		if n, ok := ports[a.Name]; ok {
			adapters[i].Name = n
		}
	}
	inv := Assemble(Raw{
		Hostname: "Dr-Patel-MacBook", Manufacturer: "Apple", Model: MacModel(h), BIOSSerial: h.Serial, BIOSVersion: h.BootROM,
		TotalVisible: 16 << 30, CPUs: []RawCPU{{Name: "Apple M3", Cores: 8}},
		OSCaption: "macOS", OSDisplayVersion: "15.1", OSBuild: "24B83",
		Adapters: adapters, PrimaryIP: "192.168.1.23",
	})
	if inv.Make != "Apple" || inv.Model != "MacBook Air (M3)" || inv.SerialNumber != "FVFG4P3XQ6LR" || inv.MemoryBytes != 16<<30 {
		t.Fatalf("identity %+v", inv)
	}
	// PRISM shows "macOS" and "15.1 (24B83)".
	if inv.OS != (OS{Name: "macOS", Edition: "macOS", Version: "15.1", Build: "24B83"}) {
		t.Fatalf("os %+v", inv.OS)
	}
	want := []Adapter{
		{Name: "Wi-Fi", IPv4: []string{"192.168.1.23"}, MAC: "A4:83:E7:2C:5D:91", Primary: true},
		{Name: "USB 10/100/1000 LAN", IPv4: []string{"10.20.1.77"}, MAC: "00:E0:4C:68:01:2B"},
	}
	if !reflect.DeepEqual(inv.Adapters, want) {
		t.Fatalf("adapters %+v", inv.Adapters)
	}
}

func TestMacDisksCountTheDataVolumeOnce(t *testing.T) {
	const gb = 1 << 30
	mounts := []MacMount{
		{Path: "/", FSType: "apfs", Local: true, Size: 494 * gb, Free: 212 * gb},
		{Path: "/System/Volumes/VM", FSType: "apfs", Local: true, Size: 494 * gb, Free: 212 * gb},
		{Path: "/System/Volumes/Preboot", FSType: "apfs", Local: true, Size: 494 * gb, Free: 212 * gb},
		{Path: "/System/Volumes/Data", FSType: "apfs", Local: true, Size: 494 * gb, Free: 212 * gb},
		{Path: "/dev", FSType: "devfs", Local: true, Size: 1},
		{Path: "/Volumes/Backup", FSType: "exfat", Local: true, Size: 1000 * gb, Free: 400 * gb},
		{Path: "/Volumes/Projects", FSType: "apfs", Local: true, Size: 2000 * gb, Free: 900 * gb},
		{Path: "/Volumes/CAMERA", FSType: "msdos", Local: true, Size: 64 * gb, Free: 10 * gb},
		{Path: "/Volumes/Shared", FSType: "smbfs", Local: false, Size: 4000 * gb, Free: 1 * gb},
		{Path: "/Volumes/Installer", FSType: "hfs", Local: true, Size: 1 * gb, Free: 0},
	}
	info := map[string]string{
		"/System/Volumes/Data": "macos-diskutil-data.plist", "/Volumes/Backup": "macos-diskutil-usb.plist",
		"/Volumes/Projects": "macos-diskutil-tb.plist", "/Volumes/CAMERA": "macos-diskutil-sd.plist",
		"/Volumes/Installer": "macos-diskutil-dmg.plist",
	}
	disks := MacDisks(mounts, func(p string) (MacDiskInfo, bool) {
		f, ok := info[p]
		if !ok {
			return MacDiskInfo{}, false
		}
		d, err := ParseDiskutilInfo(fixture(t, f))
		return d, err == nil
	})
	got := Assemble(Raw{Disks: disks}).Disks
	kinds := map[string]string{}
	for _, d := range got {
		kinds[d.Name] = d.Kind
	}
	// The mounted installer disk image isn't a disk of this Mac.
	want := map[string]string{"Macintosh HD": "fixed", "Backup": "usb", "Projects": "external", "CAMERA": "removable"}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("disks %v, want %v", kinds, want)
	}
	if got[0].Name != "Macintosh HD" || got[0].SizeBytes != 494*gb || got[0].FreeBytes != 212*gb {
		t.Fatalf("data volume %+v", got[0])
	}
}

func TestMacAppsFromInfoPlists(t *testing.T) {
	when := time.Date(2026, 10, 31, 9, 0, 0, 0, time.UTC)
	chrome, ok := ParseAppInfoPlist(fixture(t, "macos-chrome-info.plist"), "Google Chrome", when)
	if !ok || chrome != (RawSoftware{Name: "Google Chrome", Version: "130.0.6723.92", Publisher: "Google LLC", InstallDate: "2026-10-31"}) {
		t.Fatalf("chrome %+v", chrome)
	}
	// Binary plists (most apps), the identifier as the publisher when there
	// is no copyright line, CFBundleVersion when there is no short version.
	bin, _ := plist.Marshal(map[string]any{"CFBundleName": "zoom.us", "CFBundleIdentifier": "us.zoom.xos", "CFBundleVersion": "6.2.5"}, plist.BinaryFormat)
	zoom, ok := ParseAppInfoPlist(bin, "zoom.us", time.Time{})
	if !ok || zoom.Name != "zoom.us" || zoom.Version != "6.2.5" || zoom.Publisher != "Zoom" || zoom.InstallDate != "" {
		t.Fatalf("zoom %+v", zoom)
	}
	for in, want := range map[string]string{
		"© 2024 Zoom Video Communications, Inc. All rights reserved.":       "Zoom Video Communications, Inc",
		"Copyright © 2008-2024 Microsoft Corporation. All rights reserved.": "Microsoft Corporation",
		"(c) 1999-2024 Igor Pavlov":                                         "Igor Pavlov",
	} {
		if got := publisher(in, ""); got != want {
			t.Errorf("publisher(%q) = %q, want %q", in, got, want)
		}
	}
	// Garbage isn't an app; no name falls back to the folder name.
	if _, ok := ParseAppInfoPlist([]byte("not a plist"), "X", when); ok {
		t.Fatal("garbage accepted")
	}
	noName, _ := plist.Marshal(map[string]any{"CFBundleIdentifier": "com.example.tool"}, plist.XMLFormat)
	if s, ok := ParseAppInfoPlist(noName, "Example Tool", when); !ok || s.Name != "Example Tool" {
		t.Fatalf("fallback name: %+v", s)
	}
	// Through Assemble: one per name and version, sorted.
	soft := Assemble(Raw{Software: []RawSoftware{zoom, chrome, chrome}}).Software
	if len(soft) != 2 || soft[0].Name != "Google Chrome" || !strings.HasPrefix(soft[1].Name, "zoom") {
		t.Fatalf("software %+v", soft)
	}
}

const vmStatM3 = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3615.
Pages active:                            338012.
Pages inactive:                          330154.
Pages speculative:                         2190.
Pages throttled:                              0.
Pages wired down:                        127530.
Pages purgeable:                           9025.
"Translation faults":                 512345678.
Pages copy-on-write:                   12345678.
Pages zero filled:                    234567890.
Pages reactivated:                     12345678.
Pages purged:                           1234567.
File-backed pages:                       216054.
Anonymous pages:                         454302.
Pages stored in compressor:              455631.
Pages occupied by compressor:            143875.
Decompressions:                        12345678.
Compressions:                          23456789.
Pageins:                                9876543.
Pageouts:                                 12345.
Swapins:                                      0.
Swapouts:                                     0.
`

func TestVMStatMemoryInUse(t *testing.T) {
	// (338012 + 127530 + 143875) pages × 16 KiB ≈ 9.3 GiB of 16.
	want := uint64(338012+127530+143875) * 16384
	if got := ParseVMStat(vmStatM3); got != want {
		t.Fatalf("used %d, want %d", got, want)
	}
	// Intel Macs have 4 KiB pages.
	if got := ParseVMStat("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages active: 10.\nPages wired down: 5.\n"); got != 15*4096 {
		t.Fatalf("intel %d", got)
	}
	if ParseVMStat("") != 0 {
		t.Fatal("nothing should be nothing")
	}
}

func TestMacSnapshot(t *testing.T) {
	now := time.Date(2026, 11, 4, 14, 0, 0, 0, time.UTC)
	used := ParseVMStat(vmStatM3)
	s := BuildSnapshot(SnapRaw{
		OSCaption: "macOS", OSDisplayVersion: "15.1", OSBuild: "24B83", LastBoot: now.Add(-30 * time.Hour),
		MemTotal: 16 << 30, MemFree: 16<<30 - used,
		Disks:     []RawDisk{{Name: "Macintosh HD", DriveType: 3, Size: 494 << 30, Free: 212 << 30}},
		Directory: "Active Directory: riverside.local",
	}, `RIVERSIDE\apatel`, "0.6.0", now)
	if s.OS != (SnapOS{Name: "macOS", Version: "15.1", Build: "24B83"}) || s.UptimeSec != 30*3600 {
		t.Fatalf("os/uptime %+v", s)
	}
	if s.Memory == nil || s.Memory.UsedBytes != used || s.Directory != "Active Directory: riverside.local" || s.Domain != "" {
		t.Fatalf("memory/directory %+v", s)
	}
	if len(s.Disks) != 1 || s.Disks[0].Name != "Macintosh HD" {
		t.Fatalf("disks %+v", s.Disks)
	}
}
