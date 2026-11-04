//go:build darwin || linux

package inventory

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const cmdTimeout = 30 * time.Second

// systemDirs: where tools are looked for when named without a path. Never
// the inherited PATH, so a folder someone else can write to is never
// searched by the root service.
var systemDirs = []string{"/usr/bin", "/usr/sbin", "/bin", "/sbin"}

func toolPath(name string) (string, error) {
	if filepath.IsAbs(name) {
		return name, nil
	}
	for _, d := range systemDirs {
		p := filepath.Join(d, name)
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() && st.Mode()&0o111 != 0 {
			return p, nil
		}
	}
	return "", fmt.Errorf("%s: %w", name, errors.New("not installed"))
}

// run: a tool with fixed arguments, a timeout and no shell.
func run(name string, args ...string) ([]byte, error) {
	path, err := toolPath(name)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, args...).Output()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("%s timed out", name)
	}
	return out, err
}
