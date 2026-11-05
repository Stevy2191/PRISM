package enroll

import "strings"

// LinuxPackageFormat: the package format a Linux computer installs (deb,
// rpm or pacman), from /etc/os-release's ID and ID_LIKE (Ubuntu, Mint and
// Pop!_OS say debian; Fedora, RHEL, Rocky and Alma say fedora or rhel;
// Manjaro and EndeavourOS say arch), else from which package manager is
// installed. "" when neither tells: PRISM then offers no update rather
// than a guess.
func LinuxPackageFormat(osr map[string]string, has func(tool string) bool) string {
	ids := strings.Fields(strings.ToLower(osr["ID"] + " " + osr["ID_LIKE"]))
	for _, id := range ids {
		switch id {
		case "debian", "ubuntu":
			return "deb"
		case "fedora", "rhel", "centos":
			return "rpm"
		case "arch", "archlinux":
			return "pacman"
		}
	}
	switch {
	case has("dpkg-query"):
		return "deb"
	case has("pacman"):
		return "pacman"
	case has("rpm"):
		return "rpm"
	}
	return ""
}
