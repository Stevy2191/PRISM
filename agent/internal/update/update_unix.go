//go:build darwin || linux

package update

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

// prepareDir: the updates folder is the agent's (root's) alone, reset to
// 0700 before each update, and refused if it is a symlink or someone
// else's, so no user can plant or swap a package between the check and
// the installer (as the Windows ACL is reset).
func prepareDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	st, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("%s is not a folder", dir)
	}
	if sys, ok := st.Sys().(*syscall.Stat_t); !ok || int(sys.Uid) != os.Geteuid() {
		return errors.New("the updates folder belongs to someone else")
	}
	return os.Chmod(dir, 0o700)
}
