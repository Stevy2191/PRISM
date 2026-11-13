package inventory

// Who is at a Linux computer, and its realm (plan 8c, Task 1): parsing for
// user_linux.go, plain Go so it's tested on every OS.

import (
	"bufio"
	"regexp"
	"strings"
)

// linuxUsername: local names, SSSD's fully qualified ones
// ("maria@riverside.local") and winbind's ("RIVERSIDE\maria",
// "RIVERSIDE+maria"); nothing that could be read as an option.
var linuxUsername = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._@\\+-]{0,127}$`)

// IsLinuxPerson: a person's account (uid 1000 or above, not nobody), with a
// safe name.
func IsLinuxPerson(name string, uid uint32) bool {
	return uid >= 1000 && uid != 65534 && linuxUsername.MatchString(name) && name != "nobody"
}

// ParseSessionIDs reads `loginctl list-sessions --no-legend`: the first
// column of each line.
func ParseSessionIDs(text string) []string {
	var ids []string
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) > 0 {
			ids = append(ids, f[0])
		}
	}
	return ids
}

// ParseKeyValues reads `loginctl show-session … -p …` (Key=value lines).
func ParseKeyValues(text string) map[string]string {
	out := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		if k, v, ok := strings.Cut(sc.Text(), "="); ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

// IsDesktopSession: the person at the screen, not SSH, a text console or
// the login screen.
func IsDesktopSession(p map[string]string) bool {
	t := p["Type"]
	return p["Active"] == "yes" && p["Remote"] == "no" && (t == "x11" || t == "wayland") && p["Class"] == "user"
}

// ParseRealmList reads `realm list --name-only`: the first realm joined.
func ParseRealmList(text string) string {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		if d := strings.ToLower(strings.TrimSpace(sc.Text())); d != "" {
			return d
		}
	}
	return ""
}

// ParseGetentPasswd reads one `getent passwd <uid>` line: the name.
func ParseGetentPasswd(line string) string {
	name, _, _ := strings.Cut(strings.TrimSpace(line), ":")
	return name
}

// LinuxPerson: the account as PRISM shows it and the UPN. On a computer
// joined to a realm, "DOMAIN\maria" (the domain's first label, as on Windows
// and macOS) and maria@<realm>; SSSD's fully qualified names give both.
// Otherwise the plain name and no UPN (the placeholder).
func LinuxPerson(name, realm string) *SignedUser {
	short, domain := name, ""
	// winbind's DOMAIN\maria or DOMAIN+maria: the short name, in the realm.
	if i := strings.LastIndexAny(name, `\+`); i > 0 && i < len(name)-1 && !strings.Contains(name, "@") {
		short = name[i+1:]
		if realm == "" {
			return &SignedUser{Account: strings.ToUpper(name[:i]) + `\` + short}
		}
	}
	if s, d, ok := strings.Cut(name, "@"); ok && s != "" && d != "" {
		short, domain = s, strings.ToLower(d)
	} else if realm != "" {
		domain = realm
	}
	if domain == "" {
		return &SignedUser{Account: short}
	}
	label, _, _ := strings.Cut(domain, ".")
	return &SignedUser{Account: strings.ToUpper(label) + `\` + short, UPN: short + "@" + domain}
}
