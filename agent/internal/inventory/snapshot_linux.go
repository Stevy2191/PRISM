package inventory

import (
	"time"

	"golang.org/x/sys/unix"
)

// CollectSnapshot reads a Linux computer's health snapshot for a tray
// ticket (plan 8c, Task 3): distribution and kernel, uptime, memory in use
// (MemTotal − MemAvailable), free space per file system (Task 2's rules),
// IP addresses and the realm it has joined. Files under /proc, statfs, and
// lsblk and realm (no package lists: it has to be quick).
func CollectSnapshot(account, agentVersion string) Snapshot {
	r := SnapRaw{}
	r.OSCaption, r.OSDisplayVersion = LinuxOS(ParseOSRelease(readFile("/etc/os-release")))
	var u unix.Utsname
	if unix.Uname(&u) == nil {
		r.OSBuild = cstr(u.Release[:])
	}
	if up := ParseUptime(readFile("/proc/uptime")); up > 0 {
		r.LastBoot = time.Now().Add(-up)
	}
	// Without MemAvailable (kernels before 3.14) memory is left out rather
	// than shown as all in use.
	mem := readFile("/proc/meminfo")
	if total, avail := ParseMemTotal(mem), ParseMemAvailable(mem); avail > 0 && avail <= total {
		r.MemTotal, r.MemFree = total, avail
	}
	r.Disks = linuxDisks(func(string, error) {})
	r.Adapters = GoAdapters()
	for i := range r.Adapters {
		if LinuxVirtualAdapter(r.Adapters[i].Name) {
			r.Adapters[i].Loopback = true
		}
	}
	r.PrimaryIP = PrimaryIP()
	if b, err := run("realm", "list"); err == nil {
		r.Realm = ParseRealm(string(b))
	}
	r.Health = linuxHealth()
	return BuildSnapshot(r, account, agentVersion, time.Now())
}
