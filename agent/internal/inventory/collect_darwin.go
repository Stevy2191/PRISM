package inventory

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// The Mac collector (plan 8b, Task 2). Kernel values come from sysctl
// directly; system_profiler, networksetup and diskutil are run with fixed
// arguments and a timeout, never through a shell. A source that fails
// leaves its fields empty and is reported, as on Windows.

// The user is filled by Task 3 (console user, directory binding).
var macUser = func() (*SignedUser, string, error) { return nil, "", nil }

// Collect reads this Mac's inventory.
func Collect() (Inventory, []error) {
	var r Raw
	var errs []error
	note := func(what string, err error) {
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", what, err))
		}
	}
	r.Hostname, _ = os.Hostname()
	if n, err := unix.Sysctl("kern.hostname"); err == nil && n != "" {
		r.Hostname = strings.TrimSuffix(n, ".local")
	}

	if b, err := run("/usr/sbin/system_profiler", "-json", "-detailLevel", "mini", "SPHardwareDataType"); err == nil {
		h, perr := ParseHardwareJSON(b)
		note("system_profiler", perr)
		r.Manufacturer, r.Model, r.BIOSSerial, r.BIOSVersion = "Apple", MacModel(h), h.Serial, h.BootROM
	} else {
		note("system_profiler", err)
	}
	cpu, _ := unix.Sysctl("machdep.cpu.brand_string")
	cores, _ := unix.SysctlUint32("hw.physicalcpu")
	r.CPUs = []RawCPU{{Name: cpu, Cores: int(cores)}}
	if mem, err := unix.SysctlUint64("hw.memsize"); err == nil {
		r.TotalVisible = mem
	}
	r.OSCaption = "macOS"
	r.OSDisplayVersion, _ = unix.Sysctl("kern.osproductversion")
	r.OSBuild, _ = unix.Sysctl("kern.osversion")
	if tv, err := unix.SysctlTimeval("kern.boottime"); err == nil {
		r.LastBoot = time.Unix(tv.Sec, int64(tv.Usec)*1000)
	}

	mounts, err := macMounts()
	note("mounted volumes", err)
	r.Disks = MacDisks(mounts, func(p string) (MacDiskInfo, bool) {
		b, err := run("/usr/sbin/diskutil", "info", "-plist", p)
		if err != nil {
			return MacDiskInfo{}, false
		}
		d, err := ParseDiskutilInfo(b)
		return d, err == nil
	})

	r.Adapters = GoAdapters()
	if b, err := run("/usr/sbin/networksetup", "-listallhardwareports"); err == nil {
		names := ParseHardwarePorts(string(b))
		for i, a := range r.Adapters {
			if n, ok := names[a.Name]; ok {
				r.Adapters[i].Name = n
			}
		}
	} else {
		note("networksetup", err)
	}
	r.PrimaryIP = PrimaryIP()
	r.Software = macApps([]string{"/Applications", "/Applications/Utilities"})

	user, domain, err := macUser()
	note("signed-in user", err)
	r.User, r.Domain = user, domain
	return Assemble(r), errs
}

func cstr(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

func macMounts() ([]MacMount, error) {
	n, err := unix.Getfsstat(nil, unix.MNT_NOWAIT)
	if err != nil {
		return nil, err
	}
	buf := make([]unix.Statfs_t, n)
	if n, err = unix.Getfsstat(buf, unix.MNT_NOWAIT); err != nil {
		return nil, err
	}
	out := make([]MacMount, 0, n)
	for _, s := range buf[:n] {
		bs := uint64(s.Bsize)
		out = append(out, MacMount{
			Path: cstr(s.Mntonname[:]), FSType: cstr(s.Fstypename[:]), Local: s.Flags&unix.MNT_LOCAL != 0,
			Size: s.Blocks * bs, Free: s.Bavail * bs,
		})
	}
	if len(out) == 0 {
		return nil, errors.New("no mounted volumes")
	}
	return out, nil
}

// macApps: the .app bundles in each folder and one level of vendor folders
// below it (e.g. /Applications/Microsoft Office/…). Apps nested inside
// other apps aren't walked into.
func macApps(roots []string) []RawSoftware {
	var out []RawSoftware
	seen := map[string]bool{}
	var visit func(dir string, depth int)
	visit = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			p := filepath.Join(dir, e.Name())
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if strings.HasSuffix(e.Name(), ".app") {
				real, _ := filepath.EvalSymlinks(p)
				if seen[real] {
					continue
				}
				seen[real] = true
				ip := filepath.Join(p, "Contents", "Info.plist")
				b, err := os.ReadFile(ip)
				if err != nil {
					continue
				}
				var mod time.Time
				if st, err := os.Stat(ip); err == nil {
					mod = st.ModTime()
				}
				if s, ok := ParseAppInfoPlist(b, strings.TrimSuffix(e.Name(), ".app"), mod); ok {
					out = append(out, s)
				}
				continue
			}
			if depth < 1 {
				visit(p, depth+1)
			}
		}
	}
	for _, r := range roots {
		visit(r, 0)
	}
	return out
}
