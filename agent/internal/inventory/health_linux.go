package inventory

import (
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// The interface the default route leaves by.
func primaryInterface() string {
	ip := PrimaryIP()
	if ip == "" {
		return ""
	}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if strings.HasPrefix(a.String(), ip+"/") {
				return i.Name
			}
		}
	}
	return ""
}

func sysUint(path string) uint64 {
	n, _ := strconv.ParseUint(strings.TrimSpace(readFile(path)), 10, 64)
	return n
}

// linuxHealth: files under /sys and /run, and two quick tools.
func linuxHealth() []SnapLine {
	var l []SnapLine
	if _, err := os.Stat("/run/reboot-required"); err == nil {
		l = addLine(l, "Restart pending", "Yes")
	}
	if nic := primaryInterface(); nic != "" {
		if _, err := os.Stat(filepath.Join("/sys/class/net", nic, "wireless")); err == nil {
			wifi := "Wi-Fi"
			if b, err := run("iwgetid", "-r"); err == nil && tidy(string(b)) != "" {
				wifi += " \"" + tidy(string(b)) + "\""
			}
			l = addLine(l, "Network", wifi)
		} else {
			l = addLine(l, "Network", "Wired")
		}
	}
	if bats, _ := filepath.Glob("/sys/class/power_supply/BAT*"); len(bats) > 0 {
		b := bats[0]
		pct, err := strconv.Atoi(strings.TrimSpace(readFile(filepath.Join(b, "capacity"))))
		if err == nil {
			status := strings.TrimSpace(readFile(filepath.Join(b, "status")))
			full, design := sysUint(filepath.Join(b, "energy_full")), sysUint(filepath.Join(b, "energy_full_design"))
			if full == 0 {
				full, design = sysUint(filepath.Join(b, "charge_full")), sysUint(filepath.Join(b, "charge_full_design"))
			}
			l = addLine(l, "Battery", BatteryLine(pct, status != "Discharging", full, design))
		}
	}
	if b, err := run("lsblk", "-n", "-o", "TYPE"); err == nil {
		if HasCryptVolume(string(b)) {
			l = addLine(l, "Disk encryption", "LUKS on")
		} else {
			l = addLine(l, "Disk encryption", "none found")
		}
	}
	return l
}
