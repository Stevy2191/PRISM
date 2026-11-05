package inventory

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// The Linux collector (plan 8c, Task 2). Kernel values come from /proc and
// /sys; lsblk and the package managers are run with fixed arguments, a
// timeout and no shell (cmd_unix.go). A source that fails leaves its fields
// empty and is reported, as on the other platforms.

func readFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(b)
}

func dmi(name string) string {
	return strings.TrimSpace(readFile(filepath.Join("/sys/class/dmi/id", name)))
}

// Collect reads this computer's inventory.
func Collect() (Inventory, []error) {
	var r Raw
	var errs []error
	note := func(what string, err error) {
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", what, err))
		}
	}
	r.Hostname, _ = os.Hostname()

	// Hardware. product_serial is root's only: the service reads it.
	r.Manufacturer = dmi("sys_vendor")
	r.Model = LinuxModel(r.Manufacturer, dmi("product_name"), dmi("product_version"))
	r.BIOSSerial = dmi("product_serial")
	r.BIOSVersion = dmi("bios_version")

	name, cores := ParseCPUInfo(readFile("/proc/cpuinfo"))
	r.CPUs = []RawCPU{{Name: name, Cores: cores}}
	r.TotalVisible = ParseMemTotal(readFile("/proc/meminfo"))
	if up := ParseUptime(readFile("/proc/uptime")); up > 0 {
		r.LastBoot = time.Now().Add(-up)
	}

	r.OSCaption, r.OSDisplayVersion = LinuxOS(ParseOSRelease(readFile("/etc/os-release")))
	var u unix.Utsname
	if unix.Uname(&u) == nil {
		r.OSBuild = cstr(u.Release[:])
	}

	r.Disks = linuxDisks(note)

	r.Adapters = GoAdapters()
	for i := range r.Adapters {
		if LinuxVirtualAdapter(r.Adapters[i].Name) {
			r.Adapters[i].Loopback = true // skipped like the loopback
		}
	}
	r.PrimaryIP = PrimaryIP()
	r.Software = linuxSoftware(note)

	user, realm, err := desktopUser()
	note("signed-in user", err)
	r.User, r.Domain = user, realm
	return Assemble(r), errs
}

func cstr(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

func linuxDisks(note func(string, error)) []RawDisk {
	mounts := ParseMountInfo(readFile("/proc/self/mountinfo"))
	var blocks map[string]BlockInfo
	if b, err := run("lsblk", "-J", "-o", "NAME,TRAN,RM,HOTPLUG,LABEL,MOUNTPOINTS"); err == nil {
		blocks, err = ParseLsblk(b)
		note("lsblk", err)
	} else {
		note("lsblk", err)
	}
	return LinuxDisks(mounts, func(p string) (FSSize, bool) {
		var s unix.Statfs_t
		if unix.Statfs(p, &s) != nil {
			return FSSize{}, false
		}
		bs := uint64(s.Bsize)
		return FSSize{Size: s.Blocks * bs, Free: s.Bavail * bs}, true
	}, blocks)
}

// linuxSoftware: what someone installed, by whichever package manager the
// system has, then Flatpak and Snap apps; the explicit packages first, cut
// at what the server takes.
func linuxSoftware(note func(string, error)) []RawSoftware {
	var out []RawSoftware
	switch {
	case has("dpkg-query"):
		manual, err := run("apt-mark", "showmanual")
		note("apt-mark", err)
		list, err := run("dpkg-query", "-W", "-f", `${binary:Package}\t${Version}\t${Maintainer}\t${db-fsys:Last-Modified}\n`)
		note("dpkg-query", err)
		out = ParseDpkg(string(list), LineSet(string(manual)))
	case has("rpm"):
		// -C: from the local cache only, never the network.
		user, err := run("dnf", "-C", "-q", "repoquery", "--userinstalled", "--qf", `%{name}\n`)
		note("dnf repoquery", err)
		list, err := run("rpm", "-qa", "--qf", `%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME}\n`)
		note("rpm", err)
		out = ParseRPM(string(list), LineSet(string(user)))
	case has("pacman"):
		// The C locale, so the install dates parse.
		list, err := runEnv([]string{"LC_ALL=C"}, "pacman", "-Qei")
		note("pacman", err)
		out = ParsePacman(string(list))
	}
	if has("flatpak") {
		b, err := run("flatpak", "list", "--app", "--columns=name,application,version,origin")
		note("flatpak", err)
		out = append(out, ParseFlatpak(string(b))...)
	}
	if has("snap") {
		b, err := run("snap", "list")
		note("snap", err)
		out = append(out, ParseSnapList(string(b))...)
	}
	if len(out) > MaxSoftware {
		out = out[:MaxSoftware]
	}
	return out
}

func has(tool string) bool { _, err := toolPath(tool); return err == nil }
