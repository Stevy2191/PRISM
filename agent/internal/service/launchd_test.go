package service

import (
	"os"
	"path/filepath"
	"testing"

	"howett.net/plist"
)

type parsedJob struct {
	Label                  string   `plist:"Label"`
	ProgramArguments       []string `plist:"ProgramArguments"`
	RunAtLoad              bool     `plist:"RunAtLoad"`
	KeepAlive              bool     `plist:"KeepAlive"`
	ThrottleInterval       int      `plist:"ThrottleInterval"`
	StandardOutPath        string   `plist:"StandardOutPath"`
	UserName               string   `plist:"UserName"`
	LimitLoadToSessionType string   `plist:"LimitLoadToSessionType"`
}

func TestTheDaemonRunsTheAgentAsRootAndStaysUp(t *testing.T) {
	var j parsedJob
	if _, err := plist.Unmarshal(DaemonPlist(MacAgentBin), &j); err != nil {
		t.Fatal(err)
	}
	if j.Label != "com.prism.agent" || len(j.ProgramArguments) != 2 || j.ProgramArguments[0] != MacAgentBin || j.ProgramArguments[1] != "run" {
		t.Fatalf("job %+v", j)
	}
	// No UserName: a LaunchDaemon then runs as root.
	if !j.RunAtLoad || !j.KeepAlive || j.ThrottleInterval != 30 || j.UserName != "" || j.StandardOutPath != MacLog {
		t.Fatalf("job %+v", j)
	}
}

func TestTheTrayStartsInEachUsersSession(t *testing.T) {
	var j parsedJob
	if _, err := plist.Unmarshal(TrayPlist(MacTrayBin), &j); err != nil {
		t.Fatal(err)
	}
	if j.Label != "com.prism.tray" || j.ProgramArguments[0] != MacTrayBin || j.LimitLoadToSessionType != "Aqua" || !j.RunAtLoad || j.KeepAlive {
		t.Fatalf("job %+v", j)
	}
}

func TestPathsAreEscaped(t *testing.T) {
	var j parsedJob
	if _, err := plist.Unmarshal(DaemonPlist(`/tmp/a&b<c>/prism-agent`), &j); err != nil {
		t.Fatalf("an odd path broke the plist: %v", err)
	}
	if j.ProgramArguments[0] != `/tmp/a&b<c>/prism-agent` {
		t.Fatalf("path %q", j.ProgramArguments[0])
	}
}

func TestRotateLog(t *testing.T) {
	p := filepath.Join(t.TempDir(), "agent.log")
	_ = os.WriteFile(p, make([]byte, 100), 0o644)
	RotateLog(p, 1000)
	if _, err := os.Stat(p + ".1"); err == nil {
		t.Fatal("rotated a small log")
	}
	RotateLog(p, 50)
	if _, err := os.Stat(p + ".1"); err != nil {
		t.Fatal("a big log wasn't rotated")
	}
	if _, err := os.Stat(p); err == nil {
		t.Fatal("the old log is still there")
	}
}
