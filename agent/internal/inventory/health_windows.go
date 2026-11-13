//go:build windows

package inventory

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows/registry"
)

type win32Battery struct {
	EstimatedChargeRemaining uint16
	BatteryStatus            uint16
}

type batteryFull struct{ FullChargedCapacity uint32 }
type batteryStatic struct{ DesignedCapacity uint32 }

type antiVirusProduct struct {
	DisplayName  string
	ProductState uint32
}

type encryptableVolume struct {
	DriveLetter      string
	ProtectionStatus uint32
}

func keyExists(path string) bool {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return false
	}
	k.Close()
	return true
}

// windowsHealth: the registry, a few WMI queries and netsh. Each is left
// out when it can't be read (servers have no Security Center, desktops no
// battery, Home editions no BitLocker).
func windowsHealth() []SnapLine {
	var l []SnapLine
	if keyExists(`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`) ||
		keyExists(`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`) {
		l = addLine(l, "Restart pending", "Yes, for Windows updates")
	}

	// netsh from System32 by its full path, with a short limit.
	netsh := filepath.Join(os.Getenv("SystemRoot"), "System32", "netsh.exe")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	cmd := exec.CommandContext(ctx, netsh, "wlan", "show", "interfaces")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	cancel()
	if wifi := ParseNetshWlan(string(out)); err == nil && wifi != "" {
		l = addLine(l, "Network", wifi)
	} else if PrimaryIP() != "" {
		l = addLine(l, "Network", "Wired")
	}

	var bats []win32Battery
	if wmi.Query("SELECT EstimatedChargeRemaining, BatteryStatus FROM Win32_Battery", &bats) == nil && len(bats) > 0 {
		var full []batteryFull
		var static []batteryStatic
		var f, d uint64
		if wmi.QueryNamespace("SELECT FullChargedCapacity FROM BatteryFullChargedCapacity", &full, `root\wmi`) == nil && len(full) > 0 {
			f = uint64(full[0].FullChargedCapacity)
		}
		if wmi.QueryNamespace("SELECT DesignedCapacity FROM BatteryStaticData", &static, `root\wmi`) == nil && len(static) > 0 {
			d = uint64(static[0].DesignedCapacity)
		}
		// BatteryStatus 1 = discharging; anything else is on the charger.
		l = addLine(l, "Battery", BatteryLine(int(bats[0].EstimatedChargeRemaining), bats[0].BatteryStatus != 1, f, d))
	}

	var avs []antiVirusProduct
	if wmi.QueryNamespace("SELECT DisplayName, ProductState FROM AntiVirusProduct", &avs, `root\SecurityCenter2`) == nil {
		var names []string
		for _, a := range avs {
			if n := tidy(a.DisplayName); n != "" {
				names = append(names, n+" ("+AntivirusState(a.ProductState)+")")
			}
		}
		l = addLine(l, "Antivirus", strings.Join(names, "; "))
	}

	sys := os.Getenv("SystemDrive")
	if sys == "" {
		sys = "C:"
	}
	var vols []encryptableVolume
	if wmi.QueryNamespace("SELECT DriveLetter, ProtectionStatus FROM Win32_EncryptableVolume", &vols, `root\CIMV2\Security\MicrosoftVolumeEncryption`) == nil {
		for _, v := range vols {
			if strings.EqualFold(v.DriveLetter, sys) {
				l = addLine(l, "Disk encryption", BitLockerLine(v.ProtectionStatus))
			}
		}
	}
	return l
}
