package update

// Linux packages arrive with 8c (.deb, .rpm, .pkg.tar.zst by distribution).
const packageExt = ".pkg"

// PlatformInstall: none yet; offers are refused (and logged).
var PlatformInstall func(path, version string) error
