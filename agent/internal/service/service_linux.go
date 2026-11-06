// Package service: the platform's service manager. On Linux, systemd (plan
// 8c, Task 4): `run` is a plain foreground process that systemd starts and
// stops (SIGTERM); its output goes to the journal (journalctl -u prism-agent).
package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// IsService: systemd starts `run` as a normal process; there is no service
// handshake as on Windows.
func IsService() bool { return false }

// Run isn't used on Linux (see IsService).
func Run(func(ctx context.Context, logf func(string, ...any))) error {
	return errors.New("systemd runs `prism-agent run` directly")
}

func needRoot() error {
	if os.Geteuid() != 0 {
		return errors.New("run this with sudo")
	}
	return nil
}

func systemctl(args ...string) error {
	out, err := exec.Command("/usr/bin/systemctl", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Install writes the unit for this executable (a computer set up by hand,
// not from a package) and enables and starts it.
func Install() error {
	if err := needRoot(); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(LinuxDataDir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(LinuxUnitPath, Unit(exe), 0o644); err != nil {
		return err
	}
	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	return systemctl("enable", "--now", LinuxUnitName)
}

// Uninstall stops and disables the service and removes a unit written by
// Install (a package's own unit is the package manager's to remove).
func Uninstall() error {
	if err := needRoot(); err != nil {
		return err
	}
	_ = systemctl("disable", "--now", LinuxUnitName)
	if err := os.Remove(LinuxUnitPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return systemctl("daemon-reload")
}

// packageRemoval: the command that removes the installed package, by the
// package manager this computer has.
func packageRemoval() string {
	for _, c := range []struct{ tool, cmd string }{
		{"/usr/bin/dpkg-query", "sudo apt remove prism-agent   (apt purge prism-agent also forgets the enrollment)"},
		{"/usr/bin/rpm", "sudo dnf remove prism-agent"},
		{"/usr/bin/pacman", "sudo pacman -R prism-agent"},
	} {
		if _, err := os.Stat(c.tool); err == nil {
			return c.cmd
		}
	}
	return "your package manager (the package is prism-agent)"
}

// Remove takes the agent off this computer. One installed from a package is
// the package manager's to remove: this says which command. One set up by
// hand loses its service; with removeData, the enrollment (device key and
// settings) goes too.
func Remove(removeData bool, dataDir string) error {
	if err := needRoot(); err != nil {
		return err
	}
	if _, err := os.Stat(LinuxPackageUnit); err == nil {
		msg := "the PRISM Agent was installed as a package: remove it with\n  " + packageRemoval()
		if removeData {
			msg += "\nthen forget the enrollment with\n  sudo rm -rf " + dataDir
		}
		return errors.New(msg)
	}
	if err := Uninstall(); err != nil {
		return err
	}
	if removeData {
		// Only the agent's own folder, and only if it is one.
		if filepath.Base(dataDir) != filepath.Base(LinuxDataDir) {
			return fmt.Errorf("refusing to remove %s", dataDir)
		}
		return os.RemoveAll(dataDir)
	}
	return nil
}

// StartLog: the journal keeps and rotates the log; nothing to do.
func StartLog() {}
