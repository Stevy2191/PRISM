package update

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// The Mac's package (plan 8b, Task 6).
const packageExt = ".pkg"

// installCommand is always the system installer on the file the updater
// checked; nothing from the offer goes into it.
func installCommand(path string) []string {
	return []string{"/usr/sbin/installer", "-pkg", path, "-target", "/"}
}

// InstallPkg starts the installer in its own session, so the package's
// postinstall restarting the daemon (this process) doesn't end it. Its
// output goes to install-<version>.log beside the package. A file the
// agent downloaded has no quarantine attribute and installer run as root
// doesn't consult Gatekeeper: the install's signature is the gate.
func InstallPkg(path, version string) error {
	args := installCommand(path)
	log, err := os.OpenFile(filepath.Join(filepath.Dir(path), "install-"+version+".log"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer log.Close()
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Stdout, cmd.Stderr = log, log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// PlatformInstall is this platform's installer.
var PlatformInstall = InstallPkg
