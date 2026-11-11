//go:build windows

package update

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/windows"
)

const packageExt = ".msi"

// TrayRestartMarker, in the updates folder, asks the next service start to
// open the tray in every signed-in session (an update just closed it).
const TrayRestartMarker = "restart-tray"

// extFor: this platform has one package format.
func extFor(string) string { return packageExt }

// The updates folder allows SYSTEM and Administrators only, so no user can
// put or swap a file there between the check and msiexec. Reset each time.
func prepareDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

// InstallMSI starts msiexec on its own, detached from the service, which
// the installer stops, replaces and starts again. Its log goes beside the
// package.
//
// A silent install closes the tray (its files are replaced) and a silent
// install can't start it for anyone, so the service leaves a marker beside
// the package: the new service, once started, opens the tray again in
// every signed-in session (cmd/prism-agent, restartTraysAfterUpdate).
func InstallMSI(path, version string) error {
	_ = os.WriteFile(filepath.Join(filepath.Dir(path), TrayRestartMarker), []byte(version), 0o600)
	msiexec := filepath.Join(os.Getenv("SystemRoot"), "System32", "msiexec.exe")
	logFile := filepath.Join(filepath.Dir(path), "install-"+version+".log")
	start := func(flags uint32) error {
		cmd := exec.Command(msiexec, "/i", path, "/qn", "/norestart", "/l*v", logFile)
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags, HideWindow: true}
		if err := cmd.Start(); err != nil {
			return err
		}
		return cmd.Process.Release()
	}
	base := uint32(windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP)
	// Out of any job the service is in, so stopping the service can't end
	// the installer; a job that forbids that gets a plain detached start.
	if err := start(base | windows.CREATE_BREAKAWAY_FROM_JOB); err != nil {
		return start(base)
	}
	return nil
}

// PlatformInstall is this platform's installer.
var PlatformInstall = InstallMSI
