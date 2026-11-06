//go:build !windows

package enroll

import (
	"errors"
	"os"
)

// checkPrivileges: the device key is root's, so enrolling needs sudo.
func checkPrivileges() error {
	if skipPrivilegeCheck || os.Geteuid() == 0 {
		return nil
	}
	return errors.New("enrolling needs root: run it with sudo")
}
