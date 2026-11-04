//go:build !windows

package update

import "os"

// macOS (.pkg) and Linux (.deb, .rpm, .pkg.tar.zst) arrive with 8b and 8c.
const packageExt = ".pkg"

func prepareDir(dir string) error { return os.MkdirAll(dir, 0o700) }

// PlatformInstall: none yet; offers are refused (and logged).
var PlatformInstall func(path, version string) error
