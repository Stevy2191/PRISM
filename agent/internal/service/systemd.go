package service

// The systemd unit for Linux (plan 8c, Task 4). Plain Go with no build
// tag, so it is tested on every OS; service_linux.go writes it for a
// computer set up by hand, and the packages (Task 8) ship the same file as
// packaging/linux/prism-agent.service.

import "strings"

// Linux paths.
const (
	LinuxUnitName = "prism-agent.service"
	// A unit written by `prism-agent service install` (by hand); a package's
	// own unit lives in /usr/lib/systemd/system.
	LinuxUnitPath    = "/etc/systemd/system/" + LinuxUnitName
	LinuxPackageUnit = "/usr/lib/systemd/system/" + LinuxUnitName
	LinuxAgentBin    = "/usr/bin/prism-agent"
	LinuxDataDir     = "/var/lib/prism-agent"
)

// Unit is the service definition for the agent at bin: root, restarted on
// failure, logs to the journal. The file system is read-only to it except
// its data folder and /run (the tray's socket); /home is read-only. The
// inventory still reads what it needs (/proc, /sys, the package databases),
// and a self-update runs its package manager outside this unit (systemd-run),
// so these limits don't apply to the install.
func Unit(bin string) []byte {
	lines := []string{
		"# The PRISM Agent: reports this computer's inventory to PRISM and relays",
		"# tickets from the PRISM tray. Installed by the prism-agent package.",
		"[Unit]",
		"Description=PRISM Agent",
		"Documentation=https://github.com/Stevy2191/PRISM",
		"Wants=network-online.target",
		"After=network-online.target",
		"",
		"[Service]",
		"Type=simple",
		"ExecStart=" + bin + " run",
		"Restart=on-failure",
		"RestartSec=30",
		"KillMode=mixed",
		"ProtectSystem=full",
		"ProtectHome=read-only",
		"PrivateTmp=yes",
		"ReadWritePaths=" + LinuxDataDir + " /run",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	}
	return []byte(strings.Join(lines, "\n"))
}
