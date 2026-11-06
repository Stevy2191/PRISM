package update

import (
	"reflect"
	"strings"
	"testing"
)

func TestLinuxInstallCommands(t *testing.T) {
	run := []string{"/usr/bin/systemd-run", "--unit=prism-agent-update-0.7.0", "--collect", "--quiet", "--setenv=DEBIAN_FRONTEND=noninteractive", "--"}
	cases := map[string][]string{
		"/var/lib/prism-agent/updates/prism-agent-0.7.0.deb":         {"/usr/bin/apt-get", "install", "-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "/var/lib/prism-agent/updates/prism-agent-0.7.0.deb"},
		"/var/lib/prism-agent/updates/prism-agent-0.7.0.rpm":         {"/usr/bin/dnf", "install", "-y", "/var/lib/prism-agent/updates/prism-agent-0.7.0.rpm"},
		"/var/lib/prism-agent/updates/prism-agent-0.7.0.pkg.tar.zst": {"/usr/bin/pacman", "-U", "--noconfirm", "/var/lib/prism-agent/updates/prism-agent-0.7.0.pkg.tar.zst"},
	}
	for path, manager := range cases {
		got, err := installCommand(path, "0.7.0")
		if err != nil {
			t.Fatal(err)
		}
		if want := append(append([]string{}, run...), manager...); !reflect.DeepEqual(got, want) {
			t.Errorf("%s:\n got %q\nwant %q", path, got, want)
		}
	}
	// Anything else, or a relative path, is refused.
	for _, bad := range []string{"/var/lib/prism-agent/updates/prism-agent-0.7.0.msi", "prism-agent-0.7.0.deb", "/tmp/x.sh"} {
		if _, err := installCommand(bad, "0.7.0"); err == nil {
			t.Errorf("%s was accepted", bad)
		}
	}
	// The version only names the unit, made safe.
	got, _ := installCommand("/u/p.deb", "0.7.0-dev.12+x;rm")
	if got[1] != "--unit=prism-agent-update-0.7.0-dev.12_x_rm" {
		t.Errorf("unit %q", got[1])
	}
	if strings.Contains(strings.Join(got, " "), ";rm") {
		t.Error("the version reached the command")
	}
}

func TestFormatsNameTheirFiles(t *testing.T) {
	for f, ext := range map[string]string{"deb": ".deb", "rpm": ".rpm", "pacman": ".pkg.tar.zst", "msi": "", "": ""} {
		if extFor(f) != ext {
			t.Errorf("%q: %q", f, extFor(f))
		}
	}
}
