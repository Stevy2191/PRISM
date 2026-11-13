package inventory

import "strings"

// macHealth: pmset, system_profiler's power report, the default route's
// port and fdesetup. No restart-pending or antivirus line: macOS has no
// dependable quick answer for either.
func macHealth() []SnapLine {
	var l []SnapLine
	if b, err := run("/sbin/route", "-n", "get", "default"); err == nil {
		nic := ""
		for _, line := range strings.Split(string(b), "\n") {
			if f := strings.Fields(line); len(f) == 2 && f[0] == "interface:" {
				nic = f[1]
			}
		}
		if nic != "" {
			kind := "Wired"
			if p, err := run("/usr/sbin/networksetup", "-listallhardwareports"); err == nil {
				// "Hardware Port: Wi-Fi\nDevice: en0\n…"
				blocks := strings.Split(string(p), "Hardware Port: ")
				for _, blk := range blocks {
					if strings.Contains(blk, "Device: "+nic+"\n") && strings.HasPrefix(blk, "Wi-Fi") {
						kind = "Wi-Fi"
					}
				}
			}
			l = addLine(l, "Network", kind)
		}
	}
	if b, err := run("/usr/bin/pmset", "-g", "batt"); err == nil {
		if batt := ParsePmsetBatt(string(b)); batt != "" {
			if sp, err := run("/usr/sbin/system_profiler", "SPPowerDataType"); err == nil {
				if h := ParseMacBatteryHealth(string(sp)); h != "" {
					batt += ", " + h
				}
			}
			l = addLine(l, "Battery", batt)
		}
	}
	if b, err := run("/usr/bin/fdesetup", "status"); err == nil {
		l = addLine(l, "Disk encryption", ParseFdesetup(string(b)))
	}
	return l
}
