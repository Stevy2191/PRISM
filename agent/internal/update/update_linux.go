package update

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// Linux packages (plan 8c, Task 6): one per format.
var linuxExt = map[string]string{"deb": ".deb", "rpm": ".rpm", "pacman": ".pkg.tar.zst"}

// packageExt names the test package (the shared tests run on Linux as a
// .deb computer).
const packageExt = ".deb"

// extFor: the file extension of a format; "" for none we install.
func extFor(format string) string { return linuxExt[format] }

var unitSafe = regexp.MustCompile(`[^A-Za-z0-9.-]`)

// installCommand: the package manager on the file the updater checked, by
// its extension, run as its own transient systemd unit, so systemd stopping
// prism-agent.service during the upgrade (the package restarts it) doesn't
// end the install. Nothing from the offer goes into it but the checked path
// and the (checked) version, in the unit's name.
func installCommand(path, version string) ([]string, error) {
	if !filepath.IsAbs(path) {
		return nil, fmt.Errorf("the package path must be absolute: %s", path)
	}
	var manager []string
	switch {
	case strings.HasSuffix(path, ".deb"):
		// A path with a / makes apt install the local file. Keep a changed
		// config file as it is rather than stop to ask.
		manager = []string{"/usr/bin/apt-get", "install", "-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", path}
	case strings.HasSuffix(path, ".rpm"):
		manager = []string{"/usr/bin/dnf", "install", "-y", path}
	case strings.HasSuffix(path, ".pkg.tar.zst"):
		manager = []string{"/usr/bin/pacman", "-U", "--noconfirm", path}
	default:
		return nil, fmt.Errorf("not a package this computer installs: %s", filepath.Base(path))
	}
	unit := "prism-agent-update-" + unitSafe.ReplaceAllString(version, "_")
	return append([]string{"/usr/bin/systemd-run", "--unit=" + unit, "--collect", "--quiet",
		"--setenv=DEBIAN_FRONTEND=noninteractive", "--"}, manager...), nil
}

// InstallPackage starts the install and returns once systemd has it; the
// package's scripts restart the service. Its output is in the journal
// (journalctl -u prism-agent-update-<version>).
func InstallPackage(path, version string) error {
	args, err := installCommand(path, version)
	if err != nil {
		return err
	}
	out, err := exec.Command(args[0], args[1:]...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemd-run: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// PlatformInstall is this platform's installer.
var PlatformInstall = InstallPackage
