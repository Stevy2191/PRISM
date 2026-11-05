package inventory

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

// lfix: a Linux fixture as text (macparse_test's fixture gives bytes).
func lfix(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestLinuxOSNames(t *testing.T) {
	cases := map[string][2]string{
		"linux-ubuntu2404-os-release": {"Ubuntu", "24.04 (noble)"},
		"linux-ubuntu2204-os-release": {"Ubuntu", "22.04 (jammy)"},
		"linux-fedora41-os-release":   {"Fedora Linux", "41"},
		"linux-arch-os-release":       {"Arch Linux", "rolling"},
	}
	for file, want := range cases {
		name, version := LinuxOS(ParseOSRelease(lfix(t, file)))
		if name != want[0] || version != want[1] {
			t.Errorf("%s: %q %q, want %q %q", file, name, version, want[0], want[1])
		}
	}
	if n, v := LinuxOS(map[string]string{}); n != "Linux" || v != "" {
		t.Errorf("empty: %q %q", n, v)
	}
	osr := ParseOSRelease("NAME='Some \\\"Distro\\\"'\n# comment\nVERSION_ID=1\n")
	if osr["NAME"] != `Some "Distro"` || osr["VERSION_ID"] != "1" {
		t.Errorf("quoting: %+v", osr)
	}
}

func TestLinuxModel(t *testing.T) {
	if m := LinuxModel("LENOVO", "20XW0055US", "ThinkPad X1 Carbon Gen 9"); m != "ThinkPad X1 Carbon Gen 9" {
		t.Errorf("lenovo %q", m)
	}
	if m := LinuxModel("Dell Inc.", "Latitude 7440", "1.2.3"); m != "Latitude 7440" {
		t.Errorf("dell %q", m)
	}
	if m := LinuxModel("System manufacturer", "System Product Name", ""); m != "" {
		t.Errorf("placeholder %q", m)
	}
}

func TestCPUAndMemory(t *testing.T) {
	name, cores := ParseCPUInfo(lfix(t, "linux-xeon-cpuinfo"))
	if name != "Intel(R) Xeon(R) Processor @ 2.80GHz" || cores != 4 {
		t.Errorf("xeon %q %d", name, cores)
	}
	// Hyper-threads share a core: 4 processors, 3 distinct cores here.
	name, cores = ParseCPUInfo(lfix(t, "linux-laptop-cpuinfo"))
	if name != "13th Gen Intel(R) Core(TM) i7-1365U" || cores != 3 {
		t.Errorf("laptop %q %d", name, cores)
	}
	// ARM: no model name, no core ids: the processor count.
	name, cores = ParseCPUInfo(lfix(t, "linux-arm-cpuinfo"))
	if name != "" || cores != 4 {
		t.Errorf("arm %q %d", name, cores)
	}
	if m := ParseMemTotal(lfix(t, "linux-meminfo")); m != 16261316*1024 {
		t.Errorf("mem %d", m)
	}
	if d := ParseUptime("12345.67 98765.43\n"); d.Seconds() < 12345 || d.Seconds() > 12346 {
		t.Errorf("uptime %v", d)
	}
}

func sizes(m map[string]FSSize) func(string) (FSSize, bool) {
	return func(p string) (FSSize, bool) { s, ok := m[p]; return s, ok }
}

func TestUbuntuLaptopDisks(t *testing.T) {
	blocks, err := ParseLsblk([]byte(lfix(t, "linux-ubuntu2404-lsblk.json")))
	if err != nil {
		t.Fatal(err)
	}
	all := map[string]FSSize{
		"/": {Size: 500 << 30, Free: 200 << 30}, "/boot/efi": {Size: 1 << 30, Free: 1 << 29},
		"/media/sam/BACKUP DRIVE": {Size: 64 << 30, Free: 10 << 30}, "/media/sam/3061-3135": {Size: 32 << 30, Free: 30 << 30},
		"/mnt/share": {Size: 1 << 40, Free: 1 << 39}, "/snap/firefox/5187": {Size: 1 << 28},
	}
	raw := LinuxDisks(ParseMountInfo(lfix(t, "linux-ubuntu2404-mountinfo")), sizes(all), blocks)
	inv := Assemble(Raw{Disks: raw})
	got := []string{}
	for _, d := range inv.Disks {
		got = append(got, d.Name+"|"+d.Label+"|"+d.Kind)
	}
	want := []string{"/||fixed", "/media/sam/3061-3135|3061-3135|removable", "/media/sam/BACKUP DRIVE|BACKUP DRIVE|usb"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("disks %v, want %v", got, want)
	}
	if inv.Disks[0].SizeBytes != 500<<30 || inv.Disks[0].FreeBytes != 200<<30 {
		t.Errorf("root size %+v", inv.Disks[0])
	}
}

// btrfs: / and /home are one device, counted once; /boot isn't storage a
// person uses; a hot-plugged SATA disk (Thunderbolt dock) is external.
func TestFedoraDesktopDisks(t *testing.T) {
	blocks, err := ParseLsblk([]byte(lfix(t, "linux-fedora41-lsblk.json")))
	if err != nil {
		t.Fatal(err)
	}
	all := map[string]FSSize{
		"/": {Size: 1 << 40, Free: 1 << 39}, "/home": {Size: 1 << 40, Free: 1 << 39},
		"/boot": {Size: 1 << 30, Free: 1 << 29}, "/run/media/alex/Projects": {Size: 2 << 40, Free: 1 << 40},
	}
	inv := Assemble(Raw{Disks: LinuxDisks(ParseMountInfo(lfix(t, "linux-fedora41-mountinfo")), sizes(all), blocks)})
	got := []string{}
	for _, d := range inv.Disks {
		got = append(got, d.Name+"|"+d.Label+"|"+d.Kind)
	}
	want := []string{"/|fedora|fixed", "/run/media/alex/Projects|Projects|external"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("disks %v, want %v", got, want)
	}
}

func TestMountEscapesAndBadLsblk(t *testing.T) {
	m := ParseMountInfo("80 28 8:1 / /media/a\\040b rw - exfat /dev/sda1 rw\nnot a line\n")
	if len(m) != 1 || m[0].Path != "/media/a b" || m[0].FSType != "exfat" || m[0].MajMin != "8:1" {
		t.Fatalf("%+v", m)
	}
	if _, err := ParseLsblk([]byte("not json")); err == nil {
		t.Fatal("expected an error")
	}
	// No lsblk at all: a /media mount is still external.
	d := LinuxDisks(m, sizes(map[string]FSSize{"/media/a b": {Size: 1, Free: 1}}), nil)
	if len(d) != 1 || d[0].Interface != "External" || d[0].Label != "a b" {
		t.Fatalf("%+v", d)
	}
}

func TestVirtualAdapters(t *testing.T) {
	for _, n := range []string{"docker0", "veth1a2b", "br-9f8e", "virbr0", "tailscale0", "wg0", "tun0", "vboxnet0"} {
		if !LinuxVirtualAdapter(n) {
			t.Errorf("%s should be virtual", n)
		}
	}
	for _, n := range []string{"enp3s0", "wlp2s0", "eth0", "wlan0", "eno1"} {
		if LinuxVirtualAdapter(n) {
			t.Errorf("%s isn't virtual", n)
		}
	}
}

func names(s []RawSoftware) string {
	out := []string{}
	for _, x := range s {
		out = append(out, x.Name+"@"+x.Version+"@"+x.Publisher+"@"+x.InstallDate)
	}
	return strings.Join(out, "\n")
}

func TestDpkgKeepsWhatSomeoneInstalled(t *testing.T) {
	got := ParseDpkg(lfix(t, "linux-ubuntu2404-dpkg.txt"), LineSet(lfix(t, "linux-ubuntu2404-apt-manual.txt")))
	want := strings.Join([]string{
		"apt@2.8.3@Ubuntu Developers@20261024",
		"curl@8.5.0-2ubuntu10.16@Ubuntu Developers@20261027",
		"git@1:2.43.0-1ubuntu7.4@Ubuntu Developers@20261027",
		"code@1.95.3-1731513102@Microsoft Corporation@20241105",
		"libreoffice-writer@4:24.2.7-0ubuntu0.24.04.1@Ubuntu Developers@20241027",
		"google-chrome-stable@131.0.6778.69-1@Chrome Linux Team@20241107",
	}, "\n")
	if names(got) != want {
		t.Fatalf("got\n%s\nwant\n%s", names(got), want)
	}
	// An arch-qualified name matches its plain manual name.
	if s := ParseDpkg("libfoo:amd64\t1\tX <x@y>\t0\n", map[string]bool{"libfoo": true}); len(s) != 1 || s[0].Name != "libfoo" || s[0].InstallDate != "" {
		t.Fatalf("%+v", s)
	}
}

func TestRPMKeepsUserInstalled(t *testing.T) {
	got := ParseRPM(lfix(t, "linux-fedora41-rpm.txt"), LineSet(lfix(t, "linux-fedora41-repoquery.txt")))
	want := strings.Join([]string{
		"firefox@132.0.1-1.fc41@Fedora Project@20241106",
		"gnome-shell@47.1-1.fc41@Fedora Project@20241028",
		"libreoffice-calc@24.8.2.1-2.fc41@Fedora Project@20241029",
		"NetworkManager@1.50.0-1.fc41@Fedora Project@20241028",
		"code@1.95.3-1731513157.el8@Microsoft Corporation@20241114",
	}, "\n")
	if names(got) != want {
		t.Fatalf("got\n%s\nwant\n%s", names(got), want)
	}
}

func TestPacmanExplicit(t *testing.T) {
	got := ParsePacman(lfix(t, "linux-arch-pacman-Qei.txt"))
	want := strings.Join([]string{
		"firefox@132.0.2-1@Jan Alexander Steffens (heftig)@20241113",
		"base@3-2@@20240108",
		"visual-studio-code-bin@1.95.3-1@@20241114",
	}, "\n")
	if names(got) != want {
		t.Fatalf("got\n%s\nwant\n%s", names(got), want)
	}
}

func TestFlatpakAndSnap(t *testing.T) {
	if got := names(ParseFlatpak(lfix(t, "linux-flatpak.txt"))); got != "Slack@4.41.97@Flatpak (flathub)@\nGIMP@2.10.38@Flatpak (flathub)@" {
		t.Fatalf("flatpak %q", got)
	}
	got := names(ParseSnapList(lfix(t, "linux-snap-list.txt")))
	want := "firefox@132.0.2-1@mozilla@\nspotify@1.2.48.405@spotify@\nzoom-client@6.2.5.2440@zoom@"
	if got != want {
		t.Fatalf("snap\n%s\nwant\n%s", got, want)
	}
}

// What a Linux computer sends, end to end from the fixtures: the payload
// 8a's server reads.
func TestLinuxPayloadFromFixtures(t *testing.T) {
	name, version := LinuxOS(ParseOSRelease(lfix(t, "linux-ubuntu2404-os-release")))
	cpu, cores := ParseCPUInfo(lfix(t, "linux-laptop-cpuinfo"))
	sw := ParseDpkg(lfix(t, "linux-ubuntu2404-dpkg.txt"), LineSet(lfix(t, "linux-ubuntu2404-apt-manual.txt")))
	sw = append(sw, ParseSnapList(lfix(t, "linux-snap-list.txt"))...)
	inv := Assemble(Raw{
		Hostname: "ubuntu-laptop", Manufacturer: "LENOVO", Model: LinuxModel("LENOVO", "21HM0012US", "ThinkPad T14 Gen 4"),
		BIOSSerial: "PF4ABCDE", BIOSVersion: "R2FET45W (1.25 )", CPUs: []RawCPU{{Name: cpu, Cores: cores}},
		TotalVisible: ParseMemTotal(lfix(t, "linux-meminfo")), OSCaption: name, OSDisplayVersion: version, OSBuild: "6.8.0-48-generic",
		Software: sw,
	})
	if inv.Make != "LENOVO" || inv.Model != "ThinkPad T14 Gen 4" || inv.SerialNumber != "PF4ABCDE" {
		t.Errorf("hardware %+v", inv)
	}
	if inv.OS.Name != "Ubuntu" || inv.OS.Edition != "Ubuntu" || inv.OS.Version != "24.04 (noble)" || inv.OS.Build != "6.8.0-48-generic" {
		t.Errorf("os %+v", inv.OS)
	}
	if inv.CPU.Model == "" || inv.MemoryBytes != 16261316*1024 {
		t.Errorf("cpu/mem %+v %d", inv.CPU, inv.MemoryBytes)
	}
	if len(inv.Software) != 9 || inv.Software[0].Name != "apt" {
		t.Errorf("software %d %+v", len(inv.Software), inv.Software)
	}
}
