package enroll

import "testing"

func TestLinuxPackageFormat(t *testing.T) {
	none := func(string) bool { return false }
	cases := []struct {
		id, like, want string
	}{
		{"ubuntu", "debian", "deb"},
		{"linuxmint", "ubuntu debian", "deb"},
		{"pop", "ubuntu debian", "deb"},
		{"debian", "", "deb"},
		{"fedora", "", "rpm"},
		{"rocky", "rhel centos fedora", "rpm"},
		{"almalinux", "rhel centos fedora", "rpm"},
		{"arch", "", "pacman"},
		{"manjaro", "arch", "pacman"},
		{"endeavouros", "arch", "pacman"},
		{"opensuse-tumbleweed", "opensuse suse", ""},
	}
	for _, c := range cases {
		if got := LinuxPackageFormat(map[string]string{"ID": c.id, "ID_LIKE": c.like}, none); got != c.want {
			t.Errorf("%s (%s): %q, want %q", c.id, c.like, got, c.want)
		}
	}
	// Nothing in os-release: whichever package manager is there.
	if got := LinuxPackageFormat(map[string]string{}, func(t string) bool { return t == "pacman" }); got != "pacman" {
		t.Errorf("by tool: %q", got)
	}
	if got := LinuxPackageFormat(map[string]string{"ID": "Ubuntu"}, none); got != "deb" {
		t.Errorf("case: %q", got)
	}
}
