package service

import (
	"os"
	"strings"
	"testing"
)

func unitValues(t *testing.T, unit string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, l := range strings.Split(unit, "\n") {
		if k, v, ok := strings.Cut(l, "="); ok && !strings.HasPrefix(l, "#") {
			out[k] = v
		}
	}
	return out
}

func TestTheUnitRunsTheAgentAsRootAndRestarts(t *testing.T) {
	v := unitValues(t, string(Unit("/usr/bin/prism-agent")))
	if v["ExecStart"] != "/usr/bin/prism-agent run" || v["Type"] != "simple" {
		t.Fatalf("exec %q type %q", v["ExecStart"], v["Type"])
	}
	// Root: no User= or DynamicUser= (the device key and package installs are root's).
	if _, ok := v["User"]; ok {
		t.Fatal("the unit must run as root")
	}
	if v["Restart"] != "on-failure" || v["RestartSec"] != "30" || v["WantedBy"] != "multi-user.target" {
		t.Fatalf("restart/install %+v", v)
	}
	// Writable: its data folder and /run (the socket) only; /home read-only.
	if v["ProtectSystem"] != "full" || v["ProtectHome"] != "read-only" || v["ReadWritePaths"] != "/var/lib/prism-agent /run" {
		t.Fatalf("hardening %+v", v)
	}
	// A self-update installs packages: nothing may forbid gaining privileges.
	if v["NoNewPrivileges"] == "yes" || v["NoNewPrivileges"] == "true" {
		t.Fatal("NoNewPrivileges would stop the package manager")
	}
}

// The packages ship packaging/linux/prism-agent.service: it must be this unit.
func TestThePackagedUnitIsTheSame(t *testing.T) {
	b, err := os.ReadFile("../../packaging/linux/prism-agent.service")
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != string(Unit(LinuxAgentBin)) {
		t.Fatalf("packaging/linux/prism-agent.service differs from Unit(%q); regenerate it with `go run ./tools/genunit`", LinuxAgentBin)
	}
}
