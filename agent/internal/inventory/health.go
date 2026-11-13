package inventory

import (
	"fmt"
	"regexp"
	"strings"
)

// SnapLine is one extra line of the health snapshot (owner, 2026-11-13: the
// first things a technician asks): restart pending, network, battery,
// antivirus, disk encryption. Each platform reads what it can; a line it
// can't read is left out. The backend shows them as given, cleaned.
type SnapLine struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

func addLine(lines []SnapLine, label, value string) []SnapLine {
	if value = tidy(value); value == "" {
		return lines
	}
	return append(lines, SnapLine{Label: label, Value: value})
}

var (
	netshSSID   = regexp.MustCompile(`(?m)^\s*SSID\s*:\s*(.+?)\s*$`)
	netshSignal = regexp.MustCompile(`(?m)^\s*Signal\s*:\s*(\d{1,3})%`)
	netshState  = regexp.MustCompile(`(?m)^\s*State\s*:\s*connected\s*$`)
)

// ParseNetshWlan reads `netsh wlan show interfaces`: the connected network's
// name and signal, or "" when Wi-Fi isn't connected. (English output; on
// another display language the line is left out.)
func ParseNetshWlan(out string) string {
	if !netshState.MatchString(out) {
		return ""
	}
	ssid := netshSSID.FindStringSubmatch(out)
	if ssid == nil {
		return ""
	}
	s := fmt.Sprintf("Wi-Fi %q", ssid[1])
	if sig := netshSignal.FindStringSubmatch(out); sig != nil {
		s += ", signal " + sig[1] + "%"
	}
	return s
}

// BatteryLine: charge, where it's plugged in, and health (what a full charge
// holds now against when it was new) when both capacities are known.
func BatteryLine(chargePct int, onCharger bool, fullCapacity, designCapacity uint64) string {
	if chargePct < 0 || chargePct > 100 {
		return ""
	}
	s := fmt.Sprintf("%d%% charged", chargePct)
	if onCharger {
		s += ", on charger"
	} else {
		s += ", on battery"
	}
	if designCapacity > 0 && fullCapacity > 0 {
		h := fullCapacity * 100 / designCapacity
		if h > 100 {
			h = 100
		}
		s += fmt.Sprintf(", health %d%%", h)
	}
	return s
}

// AntivirusState decodes Windows Security Center's productState: whether
// real-time protection is on and the definitions are current.
func AntivirusState(productState uint32) string {
	on := productState&0x1000 != 0
	current := productState&0x10 == 0
	switch {
	case on && current:
		return "on, up to date"
	case on:
		return "on, out of date"
	default:
		return "off"
	}
}

var (
	pmsetPct     = regexp.MustCompile(`(\d{1,3})%;\s*([a-zA-Z ]+?);`)
	spMaxCap     = regexp.MustCompile(`(?m)^\s*Maximum Capacity:\s*(\d{1,3})%`)
	spCondition  = regexp.MustCompile(`(?m)^\s*Condition:\s*(.+?)\s*$`)
	lsblkCryptRe = regexp.MustCompile(`(?m)^\s*crypt\s*$`)
)

// ParsePmsetBatt reads `pmset -g batt`; health comes from system_profiler's
// power report (ParseMacBatteryHealth). "" on a Mac with no battery.
func ParsePmsetBatt(out string) string {
	m := pmsetPct.FindStringSubmatch(out)
	if m == nil {
		return ""
	}
	s := m[1] + "% charged"
	switch state := strings.TrimSpace(strings.ToLower(m[2])); {
	case strings.Contains(out, "'AC Power'"):
		s += ", on charger"
	case state == "discharging":
		s += ", on battery"
	}
	return s
}

// ParseMacBatteryHealth reads `system_profiler SPPowerDataType`.
func ParseMacBatteryHealth(out string) string {
	var parts []string
	if m := spMaxCap.FindStringSubmatch(out); m != nil {
		parts = append(parts, "health "+m[1]+"%")
	}
	if m := spCondition.FindStringSubmatch(out); m != nil && !strings.EqualFold(m[1], "Normal") {
		parts = append(parts, "condition: "+m[1])
	}
	return strings.Join(parts, ", ")
}

// ParseFdesetup reads `fdesetup status`.
func ParseFdesetup(out string) string {
	switch {
	case strings.Contains(out, "FileVault is On"):
		return "FileVault on"
	case strings.Contains(out, "FileVault is Off"):
		return "FileVault off"
	}
	return ""
}

// HasCryptVolume reads `lsblk -n -o TYPE`: true when a LUKS (dm-crypt)
// volume is open.
func HasCryptVolume(out string) bool { return lsblkCryptRe.MatchString(out) }

// BitLockerLine: Win32_EncryptableVolume.ProtectionStatus of the system drive.
func BitLockerLine(protectionStatus uint32) string {
	switch protectionStatus {
	case 1:
		return "BitLocker on"
	case 0:
		return "BitLocker off"
	}
	return ""
}
