//go:build windows

package inventory

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
	"unsafe"

	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

type win32ComputerSystem struct {
	Manufacturer        string
	Model               string
	TotalPhysicalMemory uint64
}

type win32BIOS struct {
	SerialNumber      string
	SMBIOSBIOSVersion string
}

type win32Processor struct {
	Name          string
	NumberOfCores uint32
}

type win32PhysicalMemory struct{ Capacity uint64 }

type win32OperatingSystem struct {
	Caption        string
	BuildNumber    string
	LastBootUpTime time.Time
}

type win32LogicalDisk struct {
	DeviceID   string
	VolumeName string
	DriveType  uint32
	Size       uint64
	FreeSpace  uint64
}

type win32DiskDrive struct{ InterfaceType string }

// Collect reads this computer's inventory. A source that fails leaves its
// fields empty rather than failing the whole inventory; the errors are
// returned for the log.
func Collect() (Inventory, []error) {
	var r Raw
	var errs []error
	note := func(what string, err error) {
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", what, err))
		}
	}
	r.Hostname, _ = os.Hostname()

	var cs []win32ComputerSystem
	note("Win32_ComputerSystem", wmi.Query("SELECT Manufacturer, Model, TotalPhysicalMemory FROM Win32_ComputerSystem", &cs))
	if len(cs) > 0 {
		r.Manufacturer, r.Model, r.TotalVisible = cs[0].Manufacturer, cs[0].Model, cs[0].TotalPhysicalMemory
	}
	var bios []win32BIOS
	note("Win32_BIOS", wmi.Query("SELECT SerialNumber, SMBIOSBIOSVersion FROM Win32_BIOS", &bios))
	if len(bios) > 0 {
		r.BIOSSerial, r.BIOSVersion = bios[0].SerialNumber, bios[0].SMBIOSBIOSVersion
	}
	var cpus []win32Processor
	note("Win32_Processor", wmi.Query("SELECT Name, NumberOfCores FROM Win32_Processor", &cpus))
	for _, c := range cpus {
		r.CPUs = append(r.CPUs, RawCPU{Name: c.Name, Cores: int(c.NumberOfCores)})
	}
	var mem []win32PhysicalMemory
	note("Win32_PhysicalMemory", wmi.Query("SELECT Capacity FROM Win32_PhysicalMemory", &mem))
	for _, m := range mem {
		r.MemoryModules = append(r.MemoryModules, m.Capacity)
	}
	var osInfo []win32OperatingSystem
	note("Win32_OperatingSystem", wmi.Query("SELECT Caption, BuildNumber, LastBootUpTime FROM Win32_OperatingSystem", &osInfo))
	if len(osInfo) > 0 {
		r.OSCaption, r.OSBuild, r.LastBoot = osInfo[0].Caption, osInfo[0].BuildNumber, osInfo[0].LastBootUpTime
	}
	// "24H2" and the update build revision (the .2314 in 26100.2314) are
	// only in the registry.
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		r.OSDisplayVersion, _, _ = k.GetStringValue("DisplayVersion")
		if ubr, _, err := k.GetIntegerValue("UBR"); err == nil {
			r.OSUBR = fmt.Sprint(ubr)
		}
		k.Close()
	} else {
		note("CurrentVersion", err)
	}

	var disks []win32LogicalDisk
	note("Win32_LogicalDisk", wmi.Query("SELECT DeviceID, VolumeName, DriveType, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType = 2 OR DriveType = 3", &disks))
	for _, d := range disks {
		r.Disks = append(r.Disks, RawDisk{Name: d.DeviceID, Label: d.VolumeName, DriveType: d.DriveType, Interface: diskInterface(d.DeviceID), Size: d.Size, Free: d.FreeSpace})
	}

	r.Adapters = GoAdapters()
	r.PrimaryIP = PrimaryIP()
	r.Domain = domain()
	r.Software = installedSoftware()
	user, err := consoleUser()
	note("signed-in user", err)
	r.User = user
	return Assemble(r), errs
}

// The bus of the physical disk under a drive letter ("USB" for an external
// drive): logical disk → partition → disk drive.
func diskInterface(deviceID string) string {
	var parts []struct{ DeviceID string }
	q := fmt.Sprintf(`ASSOCIATORS OF {Win32_LogicalDisk.DeviceID='%s'} WHERE AssocClass=Win32_LogicalDiskToPartition`, deviceID)
	if wmi.Query(q, &parts) != nil || len(parts) == 0 {
		return ""
	}
	var drives []win32DiskDrive
	q = fmt.Sprintf(`ASSOCIATORS OF {Win32_DiskPartition.DeviceID='%s'} WHERE AssocClass=Win32_DiskDriveToDiskPartition`, parts[0].DeviceID)
	if wmi.Query(q, &drives) != nil || len(drives) == 0 {
		return ""
	}
	return drives[0].InterfaceType
}

// The Active Directory domain this computer is joined to; "" for a
// workgroup computer.
func domain() string {
	var name *uint16
	var status uint32
	if err := windows.NetGetJoinInformation(nil, &name, &status); err != nil {
		return ""
	}
	defer windows.NetApiBufferFree((*byte)(unsafe.Pointer(name)))
	if status != windows.NetSetupDomainName {
		return ""
	}
	return windows.UTF16PtrToString(name)
}

// Programs from the machine-wide Uninstall keys, 64-bit and 32-bit.
func installedSoftware() []RawSoftware {
	var out []RawSoftware
	for _, view := range []uint32{registry.WOW64_64KEY, registry.WOW64_32KEY} {
		root, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, registry.ENUMERATE_SUB_KEYS|view)
		if err != nil {
			continue
		}
		names, _ := root.ReadSubKeyNames(-1)
		root.Close()
		for _, n := range names {
			k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\`+n, registry.QUERY_VALUE|view)
			if err != nil {
				continue
			}
			s := RawSoftware{}
			s.Name, _, _ = k.GetStringValue("DisplayName")
			s.Version, _, _ = k.GetStringValue("DisplayVersion")
			s.Publisher, _, _ = k.GetStringValue("Publisher")
			s.InstallDate, _, _ = k.GetStringValue("InstallDate")
			if v, _, err := k.GetIntegerValue("SystemComponent"); err == nil && v == 1 {
				s.SystemComponent = true
			}
			if p, _, err := k.GetStringValue("ParentKeyName"); err == nil && p != "" {
				s.IsUpdate = true
			}
			if rt, _, err := k.GetStringValue("ReleaseType"); err == nil {
				switch strings.ToLower(rt) {
				case "update", "hotfix", "security update", "service pack":
					s.IsUpdate = true
				}
			}
			k.Close()
			out = append(out, s)
		}
	}
	return out
}

// The person at the console: DOMAIN\user, and their UPN when Windows can
// say it (Active Directory, or the Entra ID sign-in cache). nil when nobody
// is signed in at the console.
func consoleUser() (*SignedUser, error) {
	session := windows.WTSGetActiveConsoleSessionId()
	if session == 0xFFFFFFFF {
		return nil, nil
	}
	var tok windows.Token
	if err := windows.WTSQueryUserToken(session, &tok); err != nil {
		// No one signed in (or not running as SYSTEM, e.g. `collect` by
		// hand): fall back to the current user.
		if errors.Is(err, windows.ERROR_NO_TOKEN) {
			return nil, nil
		}
		tok = windows.GetCurrentProcessToken()
	} else {
		defer tok.Close()
	}
	return UserFromToken(tok)
}

// ErrAnonymous: the token is the anonymous logon (a pipe client that
// refused to be identified).
var ErrAnonymous = errors.New("anonymous caller")

// UserFromToken is the token's user as DOMAIN\user with their UPN when
// Windows can say it. Used for the console user and for the tray's pipe
// client.
func UserFromToken(tok windows.Token) (*SignedUser, error) {
	tu, err := tok.GetTokenUser()
	if err != nil {
		return nil, err
	}
	if tu.User.Sid.IsWellKnown(windows.WinAnonymousSid) {
		return nil, ErrAnonymous
	}
	account, dom, _, err := tu.User.Sid.LookupAccount("")
	if err != nil {
		return nil, err
	}
	u := &SignedUser{Account: dom + `\` + account}
	u.UPN = translateUPN(u.Account)
	if u.UPN == "" {
		u.UPN = cachedUPN(tu.User.Sid.String())
	}
	return u, nil
}

// TranslateName asks Active Directory (the computer's own account can).
func translateUPN(account string) string {
	in, err := windows.UTF16PtrFromString(account)
	if err != nil {
		return ""
	}
	buf := make([]uint16, 512)
	n := uint32(len(buf))
	if err := windows.TranslateName(in, windows.NameSamCompatible, windows.NameUserPrincipal, &buf[0], &n); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

// Entra ID and Microsoft accounts: Windows caches the sign-in name per SID.
func cachedUPN(sid string) string {
	path := `SOFTWARE\Microsoft\IdentityStore\Cache\` + sid + `\IdentityCache\` + sid
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue("UserName")
	if strings.Contains(v, "@") {
		return v
	}
	return ""
}
