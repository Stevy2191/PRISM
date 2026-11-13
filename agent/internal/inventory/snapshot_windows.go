//go:build windows

package inventory

import (
	"fmt"
	"time"

	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows/registry"
)

type win32OSHealth struct {
	Caption                string
	BuildNumber            string
	LastBootUpTime         time.Time
	TotalVisibleMemorySize uint64 // KiB
	FreePhysicalMemory     uint64 // KiB
}

// CollectSnapshot reads the snapshot: two WMI queries and the registry, a
// fraction of a full inventory (no software list).
func CollectSnapshot(account, agentVersion string) Snapshot {
	var r SnapRaw
	var osInfo []win32OSHealth
	if wmi.Query("SELECT Caption, BuildNumber, LastBootUpTime, TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem", &osInfo) == nil && len(osInfo) > 0 {
		o := osInfo[0]
		r.OSCaption, r.OSBuild, r.LastBoot = o.Caption, o.BuildNumber, o.LastBootUpTime
		r.MemTotal, r.MemFree = o.TotalVisibleMemorySize*1024, o.FreePhysicalMemory*1024
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		r.OSDisplayVersion, _, _ = k.GetStringValue("DisplayVersion")
		if ubr, _, err := k.GetIntegerValue("UBR"); err == nil {
			r.OSUBR = fmt.Sprint(ubr)
		}
		k.Close()
	}
	var disks []win32LogicalDisk
	if wmi.Query("SELECT DeviceID, VolumeName, DriveType, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType = 2 OR DriveType = 3", &disks) == nil {
		for _, d := range disks {
			r.Disks = append(r.Disks, RawDisk{Name: d.DeviceID, Label: d.VolumeName, DriveType: d.DriveType, Size: d.Size, Free: d.FreeSpace})
		}
	}
	r.Adapters = GoAdapters()
	r.PrimaryIP = PrimaryIP()
	r.Domain = domain()
	r.Health = windowsHealth()
	return BuildSnapshot(r, account, agentVersion, time.Now())
}
