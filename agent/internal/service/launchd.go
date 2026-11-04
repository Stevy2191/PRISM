package service

// launchd property lists for the Mac (plan 8b, Task 5). Plain Go with no
// build tag, so the files are tested on every OS; service_darwin.go writes
// them and the .pkg (Task 8) ships the same ones.

import (
	"os"

	"howett.net/plist"
)

// The Mac's paths.
const (
	MacDaemonLabel = "com.prism.agent"
	MacTrayLabel   = "com.prism.tray"
	MacDaemonPlist = "/Library/LaunchDaemons/com.prism.agent.plist"
	MacTrayPlist   = "/Library/LaunchAgents/com.prism.tray.plist"
	MacBinDir      = "/Library/Application Support/PRISM/bin"
	MacAgentBin    = MacBinDir + "/prism-agent"
	MacAgentLink   = "/usr/local/bin/prism-agent"
	MacTrayApp     = "/Applications/Utilities/PRISM Agent.app"
	MacTrayBin     = MacTrayApp + "/Contents/MacOS/prism-tray"
	MacLogDir      = "/Library/Logs/PRISM"
	MacLog         = MacLogDir + "/agent.log"
)

// launchdJob is a launchd job definition; the plist library writes it (and
// escapes every value for XML).
type launchdJob struct {
	Label                  string   `plist:"Label"`
	ProgramArguments       []string `plist:"ProgramArguments"`
	RunAtLoad              bool     `plist:"RunAtLoad"`
	KeepAlive              bool     `plist:"KeepAlive,omitempty"`
	ThrottleInterval       int      `plist:"ThrottleInterval,omitempty"`
	StandardOutPath        string   `plist:"StandardOutPath,omitempty"`
	StandardErrorPath      string   `plist:"StandardErrorPath,omitempty"`
	LimitLoadToSessionType string   `plist:"LimitLoadToSessionType,omitempty"`
	ProcessType            string   `plist:"ProcessType"`
}

func render(j launchdJob) []byte {
	b, err := plist.MarshalIndent(j, plist.XMLFormat, "\t")
	if err != nil {
		panic(err)
	}
	return append(b, '\n')
}

// DaemonPlist runs `<bin> run` as root (a LaunchDaemon has no UserName, so
// root), at boot, restarted after a crash at most every 30 seconds, with its
// output in the agent log.
func DaemonPlist(bin string) []byte {
	return render(launchdJob{
		Label: MacDaemonLabel, ProgramArguments: []string{bin, "run"}, RunAtLoad: true, KeepAlive: true,
		ThrottleInterval: 30, StandardOutPath: MacLog, StandardErrorPath: MacLog, ProcessType: "Background",
	})
}

// TrayPlist starts the menu-bar app in each user's graphical session.
func TrayPlist(bin string) []byte {
	return render(launchdJob{
		Label: MacTrayLabel, ProgramArguments: []string{bin}, RunAtLoad: true, LimitLoadToSessionType: "Aqua", ProcessType: "Interactive",
	})
}

// RotateLog keeps the agent's log under max bytes: past it, the log becomes
// agent.log.1 (replacing the previous one) and a new one starts. launchd
// reopens the file at the daemon's next start; called at each start.
func RotateLog(path string, max int64) {
	if st, err := os.Stat(path); err == nil && st.Size() > max {
		_ = os.Rename(path, path+".1")
	}
}
