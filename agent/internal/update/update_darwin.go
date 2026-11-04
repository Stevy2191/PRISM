package update

// The Mac's package (plan 8b, Task 6 installs it).
const packageExt = ".pkg"

// PlatformInstall: none yet; offers are refused (and logged).
var PlatformInstall func(path, version string) error
