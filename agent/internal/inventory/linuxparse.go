package inventory

// Parsing for the Linux collector (collect_linux.go). Plain Go with no build
// tag, so it is tested from captured output on every OS. Everything here
// reads untrusted text (files under /proc and /sys, command output) and
// only returns values; nothing is ever run from it.

import (
	"bufio"
	"encoding/json"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---- /etc/os-release ----

// ParseOSRelease reads KEY=value lines (values may be quoted).
func ParseOSRelease(text string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
			v = strings.NewReplacer(`\"`, `"`, `\\`, `\`, `\$`, `$`, "\\`", "`").Replace(v)
		}
		out[strings.TrimSpace(k)] = v
	}
	return out
}

// LinuxOS is the distribution as PRISM shows it: "Ubuntu" with
// "24.04 (noble)", "Fedora Linux" with "41", "Arch Linux" with "rolling".
func LinuxOS(osr map[string]string) (name, version string) {
	name = tidy(osr["NAME"])
	if name == "" {
		name = "Linux"
	}
	version = tidy(osr["VERSION_ID"])
	code := tidy(osr["VERSION_CODENAME"])
	switch {
	case version == "" && (osr["ID"] == "arch" || strings.Contains(osr["BUILD_ID"], "rolling") || osr["BUILD_ID"] == "rolling"):
		version = "rolling"
	case version != "" && code != "" && !strings.Contains(strings.ToLower(osr["ID"]), "fedora"):
		version += " (" + code + ")"
	}
	return name, version
}

// ---- DMI (/sys/class/dmi/id) ----

// LinuxModel: the model from DMI. Lenovo puts its machine type code in
// product_name ("20XW0055US") and the model in product_version
// ("ThinkPad X1 Carbon Gen 9").
func LinuxModel(vendor, productName, productVersion string) string {
	v := strings.ToLower(tidy(vendor))
	if strings.HasPrefix(v, "lenovo") && tidyField(productVersion) != "" {
		return tidyField(productVersion)
	}
	return tidyField(productName)
}

// ---- /proc ----

// ParseCPUInfo: the processor's name and its physical cores (distinct
// physical id / core id pairs; "cpu cores" or the processor count when
// those aren't given, as on ARM).
func ParseCPUInfo(text string) (name string, cores int) {
	pairs := map[string]bool{}
	processors := 0
	var phys, core string
	cpuCores := 0
	flush := func() {
		if phys != "" || core != "" {
			pairs[phys+"/"+core] = true
		}
		phys, core = "", ""
	}
	for _, line := range strings.Split(text, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			if strings.TrimSpace(line) == "" {
				flush()
			}
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		switch k {
		case "processor":
			processors++
		case "model name", "Model", "cpu model":
			if name == "" {
				name = v
			}
		case "physical id":
			phys = v
		case "core id":
			core = v
		case "cpu cores":
			if n, err := strconv.Atoi(v); err == nil && n > cpuCores {
				cpuCores = n
			}
		}
	}
	flush()
	switch {
	case len(pairs) > 0:
		cores = len(pairs)
	case cpuCores > 0:
		cores = cpuCores
	default:
		cores = processors
	}
	return tidy(name), cores
}

// ParseMemTotal: MemTotal from /proc/meminfo, in bytes.
func ParseMemTotal(text string) uint64 {
	for _, line := range strings.Split(text, "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		f := strings.Fields(strings.TrimPrefix(line, "MemTotal:"))
		if len(f) == 0 {
			return 0
		}
		n, err := strconv.ParseUint(f[0], 10, 64)
		if err != nil {
			return 0
		}
		if len(f) > 1 && strings.EqualFold(f[1], "kB") {
			n *= 1024
		}
		return n
	}
	return 0
}

// ParseUptime: the seconds since boot, from /proc/uptime.
func ParseUptime(text string) time.Duration {
	f := strings.Fields(text)
	if len(f) == 0 {
		return 0
	}
	s, err := strconv.ParseFloat(f[0], 64)
	if err != nil || s < 0 {
		return 0
	}
	return time.Duration(s * float64(time.Second))
}

// ---- Disks ----

// LinuxMount is one line of /proc/self/mountinfo.
type LinuxMount struct {
	MajMin, Path, FSType, Source string
}

// ParseMountInfo reads /proc/self/mountinfo. Paths keep their escapes
// (\040 for a space) decoded.
func ParseMountInfo(text string) []LinuxMount {
	var out []LinuxMount
	for _, line := range strings.Split(text, "\n") {
		before, after, ok := strings.Cut(line, " - ")
		if !ok {
			continue
		}
		bf, af := strings.Fields(before), strings.Fields(after)
		if len(bf) < 5 || len(af) < 2 {
			continue
		}
		out = append(out, LinuxMount{MajMin: bf[2], Path: unescapeMount(bf[4]), FSType: af[0], Source: unescapeMount(af[1])})
	}
	return out
}

var octal = regexp.MustCompile(`\\[0-7]{3}`)

func unescapeMount(s string) string {
	return octal.ReplaceAllStringFunc(s, func(m string) string {
		n, _ := strconv.ParseUint(m[1:], 8, 8)
		return string(rune(n))
	})
}

// BlockInfo is what lsblk says about the disk under a mount point.
type BlockInfo struct {
	Tran      string // "usb", "nvme", "sata", "virtio"…
	Removable bool
	Hotplug   bool
	Label     string
}

type lsblkDev struct {
	Name        string          `json:"name"`
	Tran        *string         `json:"tran"`
	RM          json.RawMessage `json:"rm"`
	Hotplug     json.RawMessage `json:"hotplug"`
	Label       *string         `json:"label"`
	Mountpoints []*string       `json:"mountpoints"`
	Children    []lsblkDev      `json:"children"`
}

// lsblk prints booleans as true/false, older versions as "0"/"1".
func lsblkBool(b json.RawMessage) bool {
	s := strings.Trim(string(b), `"`)
	return s == "true" || s == "1"
}

// ParseLsblk reads `lsblk -J -o NAME,TRAN,RM,HOTPLUG,LABEL,MOUNTPOINTS`
// into mount point → what the disk it's on is. A partition, an encrypted
// volume or an LVM volume takes its disk's bus and removability.
func ParseLsblk(b []byte) (map[string]BlockInfo, error) {
	var doc struct {
		Devices []lsblkDev `json:"blockdevices"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, err
	}
	out := map[string]BlockInfo{}
	var walk func(d lsblkDev, top BlockInfo)
	walk = func(d lsblkDev, top BlockInfo) {
		info := top
		if d.Label != nil {
			info.Label = *d.Label
		} else {
			info.Label = ""
		}
		for _, m := range d.Mountpoints {
			if m != nil && *m != "" {
				out[*m] = info
			}
		}
		for _, c := range d.Children {
			walk(c, top)
		}
	}
	for _, d := range doc.Devices {
		top := BlockInfo{Removable: lsblkBool(d.RM), Hotplug: lsblkBool(d.Hotplug)}
		if d.Tran != nil {
			top.Tran = *d.Tran
		}
		walk(d, top)
	}
	return out, nil
}

var linuxDiskFS = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "f2fs": true,
	"vfat": true, "exfat": true, "ntfs": true, "ntfs3": true, "fuseblk": true, "zfs": true, "bcachefs": true,
}

// linuxSkip: mounts that aren't the computer's storage as a person sees it.
func linuxSkip(p string) bool {
	for _, pre := range []string{"/boot", "/efi", "/snap/", "/var/lib/docker", "/var/lib/containers", "/var/snap/"} {
		if p == strings.TrimSuffix(pre, "/") || strings.HasPrefix(p, strings.TrimSuffix(pre, "/")+"/") {
			return true
		}
	}
	if strings.HasPrefix(p, "/run/") && !strings.HasPrefix(p, "/run/media/") {
		return true
	}
	return strings.HasPrefix(p, "/proc") || strings.HasPrefix(p, "/sys") || strings.HasPrefix(p, "/dev")
}

// FSSize is a mount's size and free space (statfs).
type FSSize struct{ Size, Free uint64 }

// LinuxDisks turns mounts into RawDisks: real file systems only, each
// device counted once (btrfs subvolumes and bind mounts share one), the
// root first. A disk on USB is "USB", one hot-plugged otherwise (Thunderbolt
// and the like) or mounted under /media is external, an SD card removable.
func LinuxDisks(mounts []LinuxMount, size func(path string) (FSSize, bool), blocks map[string]BlockInfo) []RawDisk {
	ms := append([]LinuxMount(nil), mounts...)
	// The root first, then shortest paths: a device's first mount names it.
	sort.SliceStable(ms, func(i, j int) bool {
		if (ms[i].Path == "/") != (ms[j].Path == "/") {
			return ms[i].Path == "/"
		}
		return len(ms[i].Path) < len(ms[j].Path)
	})
	seen := map[string]bool{}
	out := []RawDisk{}
	for _, m := range ms {
		if !linuxDiskFS[m.FSType] || linuxSkip(m.Path) {
			continue
		}
		key := m.MajMin
		if key == "" || key == "0:0" {
			key = m.Source
		}
		if seen[key] {
			continue
		}
		sz, ok := size(m.Path)
		if !ok || sz.Size == 0 {
			continue
		}
		seen[key] = true
		d := RawDisk{Name: m.Path, DriveType: 3, Size: sz.Size, Free: sz.Free}
		bi, known := blocks[m.Path]
		if known {
			d.Label = bi.Label
		}
		media := strings.HasPrefix(m.Path, "/media/") || strings.HasPrefix(m.Path, "/run/media/")
		switch {
		case known && strings.EqualFold(bi.Tran, "usb"):
			d.Interface = "USB"
		case known && bi.Removable:
			d.DriveType = 2 // an SD card in a built-in reader
		case known && bi.Hotplug:
			d.Interface = "External"
		case media:
			d.Interface = "External"
		}
		if media && d.Label == "" {
			d.Label = path.Base(m.Path)
		}
		out = append(out, d)
	}
	return out
}

// ---- Network ----

var virtualIf = regexp.MustCompile(`^(docker\d*|veth.*|br-.*|virbr\d*|vnet\d*|tailscale\d*|wg\d*|tun\d*|tap\d*|zt.*|cni\d*|flannel.*|lxcbr\d*|lxdbr\d*|podman\d*|vmnet\d*|vboxnet\d*)$`)

// LinuxVirtualAdapter: container bridges, VPN tunnels and VM networks,
// which aren't the computer's own network adapters.
func LinuxVirtualAdapter(name string) bool { return virtualIf.MatchString(name) }

// ---- Software ----

// stripEmail: "Ubuntu Developers <ubuntu-devel@…>" → "Ubuntu Developers".
func stripEmail(s string) string {
	if i := strings.Index(s, "<"); i >= 0 {
		s = s[:i]
	}
	return tidy(s)
}

func unixDate(s string) string {
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || n <= 0 {
		return ""
	}
	return time.Unix(n, 0).UTC().Format("20060102")
}

// LineSet: one name per line (apt-mark showmanual, dnf repoquery).
func LineSet(text string) map[string]bool {
	out := map[string]bool{}
	for _, l := range strings.Split(text, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out[l] = true
		}
	}
	return out
}

// ParseDpkg reads
//
//	dpkg-query -W -f '${binary:Package}\t${Version}\t${Maintainer}\t${db-fsys:Last-Modified}\n'
//
// keeping the packages someone installed (manual, from apt-mark showmanual).
func ParseDpkg(text string, manual map[string]bool) []RawSoftware {
	var out []RawSoftware
	for _, line := range strings.Split(text, "\n") {
		f := strings.Split(line, "\t")
		if len(f) < 2 || f[0] == "" {
			continue
		}
		name := f[0]
		base, _, _ := strings.Cut(name, ":") // "libfoo:amd64"
		if !manual[name] && !manual[base] {
			continue
		}
		s := RawSoftware{Name: base, Version: f[1]}
		if len(f) > 2 {
			s.Publisher = stripEmail(f[2])
		}
		if len(f) > 3 {
			s.InstallDate = unixDate(f[3])
		}
		out = append(out, s)
	}
	return out
}

// ParseRPM reads
//
//	rpm -qa --qf '%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME}\n'
//
// keeping the packages someone installed (dnf repoquery --userinstalled).
func ParseRPM(text string, user map[string]bool) []RawSoftware {
	var out []RawSoftware
	for _, line := range strings.Split(text, "\n") {
		f := strings.Split(line, "\t")
		if len(f) < 2 || f[0] == "" || !user[f[0]] {
			continue
		}
		s := RawSoftware{Name: f[0], Version: f[1]}
		if len(f) > 2 && f[2] != "(none)" {
			s.Publisher = tidy(f[2])
		}
		if len(f) > 3 {
			s.InstallDate = unixDate(f[3])
		}
		out = append(out, s)
	}
	return out
}

// pacman's dates, in the C locale (strftime %c) or the ISO form some
// builds use.
var pacmanDates = []string{"Mon Jan _2 15:04:05 2006", "Mon 02 Jan 2006 03:04:05 PM MST", "2006-01-02T15:04:05 MST", "2006-01-02T15:04:05Z0700"}

// ParsePacman reads `pacman -Qei` (every explicitly installed package, as
// "Key : value" blocks): name, version, packager and install date.
func ParsePacman(text string) []RawSoftware {
	var out []RawSoftware
	var cur RawSoftware
	flush := func() {
		if cur.Name != "" {
			out = append(out, cur)
		}
		cur = RawSoftware{}
	}
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(line, " ") {
			continue // a wrapped value
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		switch k {
		case "Name":
			cur.Name = v
		case "Version":
			cur.Version = v
		case "Packager":
			if v != "Unknown Packager" {
				cur.Publisher = stripEmail(v)
			}
		case "Install Date":
			for _, layout := range pacmanDates {
				if t, err := time.Parse(layout, strings.Join(strings.Fields(v), " ")); err == nil {
					cur.InstallDate = t.Format("20060102")
					break
				}
				if t, err := time.Parse(layout, v); err == nil {
					cur.InstallDate = t.Format("20060102")
					break
				}
			}
		}
	}
	flush()
	return out
}

// ParseFlatpak reads `flatpak list --app --columns=name,application,version,origin`
// (tab-separated).
func ParseFlatpak(text string) []RawSoftware {
	var out []RawSoftware
	for _, line := range strings.Split(text, "\n") {
		f := strings.Split(line, "\t")
		if len(f) < 2 || strings.TrimSpace(f[0]) == "" {
			continue
		}
		s := RawSoftware{Name: tidy(f[0])}
		if len(f) > 2 {
			s.Version = tidy(f[2])
		}
		if len(f) > 3 && tidy(f[3]) != "" {
			s.Publisher = "Flatpak (" + tidy(f[3]) + ")"
		}
		out = append(out, s)
	}
	return out
}

// Snaps that are the snap system itself, not apps.
var snapPlumbing = regexp.MustCompile(`^(core\d*|snapd|bare|gtk-common-themes|gnome-\d+-\d+(-\d+)?|kde-frameworks-.*|mesa-.*|gpu-.*|snapd-desktop-integration)$`)

// ParseSnapList reads `snap list` (a table: Name Version Rev Tracking
// Publisher Notes), leaving out the snap system's own snaps.
func ParseSnapList(text string) []RawSoftware {
	var out []RawSoftware
	for i, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if i == 0 || len(f) < 5 || f[0] == "Name" {
			continue
		}
		notes := ""
		if len(f) > 5 {
			notes = f[5]
		}
		if snapPlumbing.MatchString(f[0]) || strings.Contains(notes, "base") || strings.Contains(notes, "snapd") {
			continue
		}
		pub := strings.TrimRight(f[4], "✓*✪")
		if pub == "-" {
			pub = ""
		}
		out = append(out, RawSoftware{Name: f[0], Version: f[1], Publisher: pub})
	}
	return out
}

// MaxSoftware is the most programs the server takes from one computer.
const MaxSoftware = 5000
