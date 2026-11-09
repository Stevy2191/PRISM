package update

import (
	"os"
	"path/filepath"
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

func TestPackageOfAnotherFormatIsRefused(t *testing.T) {
	dir := t.TempDir()
	deb := []byte("!<arch>\ndebian-binary   1700000000  0     0     100644  4         `\n2.0\n")
	rpm := []byte{0xed, 0xab, 0xee, 0xdb, 3, 0}
	zst := []byte{0x28, 0xb5, 0x2f, 0xfd, 0}
	write := func(name string, b []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, b, 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	for name, b := range map[string][]byte{"a.deb": deb, "a.rpm": rpm, "a.pkg.tar.zst": zst} {
		if err := checkFormat(write(name, b)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A genuine .rpm or Arch package saved under a .deb computer's name,
	// and the other ways round, never reach the package manager.
	for name, b := range map[string][]byte{"b.deb": rpm, "c.deb": zst, "b.rpm": deb, "b.pkg.tar.zst": rpm, "short.deb": []byte("!<a"), "d.msi": deb} {
		if err := checkFormat(write(name, b)); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}
