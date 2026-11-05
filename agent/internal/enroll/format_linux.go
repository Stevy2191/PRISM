package enroll

import (
	"os"

	"github.com/stevy2191/prism/agent/internal/inventory"
)

// PackageFormat: this computer's package format (see LinuxPackageFormat).
func PackageFormat() string {
	b, _ := os.ReadFile("/etc/os-release")
	return LinuxPackageFormat(inventory.ParseOSRelease(string(b)), func(tool string) bool {
		for _, dir := range []string{"/usr/bin", "/usr/sbin", "/bin", "/sbin"} {
			if st, err := os.Stat(dir + "/" + tool); err == nil && st.Mode().IsRegular() {
				return true
			}
		}
		return false
	})
}
