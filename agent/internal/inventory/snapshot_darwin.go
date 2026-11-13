package inventory

import (
	"time"

	"golang.org/x/sys/unix"
)

// CollectSnapshot reads the Mac's health snapshot for a tray ticket (plan
// 8b, Task 5): macOS version and build, uptime, memory in use, free space
// per volume, IP addresses and the directory binding. A few sysctls,
// vm_stat, getfsstat and diskutil per volume (no app scan).
func CollectSnapshot(account, agentVersion string) Snapshot {
	r := SnapRaw{OSCaption: "macOS"}
	r.OSDisplayVersion, _ = unix.Sysctl("kern.osproductversion")
	r.OSBuild, _ = unix.Sysctl("kern.osversion")
	if tv, err := unix.SysctlTimeval("kern.boottime"); err == nil {
		r.LastBoot = time.Unix(tv.Sec, int64(tv.Usec)*1000)
	}
	if total, err := unix.SysctlUint64("hw.memsize"); err == nil {
		r.MemTotal = total
		if b, err := run("/usr/bin/vm_stat"); err == nil {
			if used := ParseVMStat(string(b)); used > 0 && used <= total {
				r.MemFree = total - used
			}
		}
	}
	if mounts, err := macMounts(); err == nil {
		r.Disks = MacDisks(mounts, func(p string) (MacDiskInfo, bool) {
			b, err := run("/usr/sbin/diskutil", "info", "-plist", p)
			if err != nil {
				return MacDiskInfo{}, false
			}
			d, err := ParseDiskutilInfo(b)
			return d, err == nil
		})
	}
	r.Adapters = GoAdapters()
	r.PrimaryIP = PrimaryIP()
	if d := macADDomain(); d != "" {
		r.Directory = "Active Directory: " + d
	}
	r.Health = macHealth()
	return BuildSnapshot(r, account, agentVersion, time.Now())
}
