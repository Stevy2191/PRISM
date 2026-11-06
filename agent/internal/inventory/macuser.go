package inventory

// Who is at the Mac, and its directory binding (plan 8b, Task 3): parsing
// for user_darwin.go, plain Go so it's tested on every OS.

import (
	"bufio"
	"regexp"
	"strings"
)

// macUsername: a short name safe to pass to dscl as an argument (no
// slashes, no path tricks). Anything else isn't looked up.
var macUsername = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$`)

// IsMacPerson: an account a person signs in with, not root or one of the
// accounts macOS uses at the login window and during setup.
func IsMacPerson(name string, uid uint32) bool {
	if uid < 500 || !macUsername.MatchString(name) {
		return false
	}
	switch name {
	case "root", "loginwindow", "_mbsetupuser", "nobody":
		return false
	}
	return !strings.HasPrefix(name, "_")
}

// ParseDsconfigad reads `dsconfigad -show`: the Active Directory domain
// this Mac is bound to, or "" when it isn't bound.
func ParseDsconfigad(text string) string {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), "=")
		if ok && strings.TrimSpace(k) == "Active Directory Domain" {
			return strings.ToLower(strings.TrimSpace(v))
		}
	}
	return ""
}

// ParseDscl reads `dscl … -read /Users/<user> <attributes>`: each
// "Key: value" line, where a long value continues on the next, indented,
// line. The first value of each attribute.
func ParseDscl(text string) map[string]string {
	out := map[string]string{}
	key := ""
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, " ") {
			if key != "" && out[key] == "" {
				out[key] = strings.TrimSpace(line)
			}
			continue
		}
		// Keys may contain a colon themselves ("dsAttrTypeNative:mail"):
		// the value follows the last ": ", or the line ends in ":".
		if i := strings.LastIndex(line, ": "); i > 0 {
			key = line[:i]
			if _, seen := out[key]; !seen {
				out[key] = strings.TrimSpace(line[i+2:])
			}
		} else if strings.HasSuffix(line, ":") {
			key = strings.TrimSuffix(line, ":")
			out[key] = ""
		}
	}
	return out
}

// MacAccount: "RIVERSIDE\apatel" on a Mac bound to riverside.local (the
// domain's first label, as Windows writes it), else the short name.
func MacAccount(short, adDomain string) string {
	if adDomain == "" {
		return short
	}
	label, _, _ := strings.Cut(adDomain, ".")
	return strings.ToUpper(label) + `\` + short
}

// MacUPN: the directory's userPrincipalName, else the account's email.
func MacUPN(attrs map[string]string) string {
	for _, k := range []string{"dsAttrTypeNative:userPrincipalName", "EMailAddress", "dsAttrTypeNative:mail"} {
		if v := strings.TrimSpace(attrs[k]); strings.Contains(v, "@") && !strings.ContainsAny(v, " \t") {
			return v
		}
	}
	return ""
}
