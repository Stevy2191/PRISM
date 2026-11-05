package enroll

import (
	"errors"

	"golang.org/x/sys/windows"
)

// checkPrivileges: enrolling writes to C:\ProgramData\PRISM, which only
// SYSTEM (the installer) and an elevated administrator can do. Said plainly
// up front, rather than as "Access is denied" after PRISM has been asked.
func checkPrivileges() error {
	if skipPrivilegeCheck {
		return nil
	}
	if windows.GetCurrentProcessToken().IsElevated() {
		return nil
	}
	return errors.New("enrolling needs an administrator: open PowerShell with \"Run as administrator\" and run the command again")
}
