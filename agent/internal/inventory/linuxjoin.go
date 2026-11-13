package inventory

// Which directory a Linux computer is joined to (owner, 2026-11-13: an Arch
// computer joined to Active Directory reported no realm). realmd's `realm
// list` was the only source, and realmd isn't how many joins are made:
// Arch's own guides join with Samba's winbind (`net ads join`) or set up
// SSSD by hand with adcli, and realmd isn't in Arch's repositories at all.
// So, in order: realmd, SSSD's configuration, Samba's, and last a Kerberos
// realm on a computer that holds a host keytab. Plain parsing, tested on
// every OS; user_linux.go reads the files.

import (
	"bufio"
	"strings"
)

// Join is the directory: its DNS name (lower case) and its kind
// ("active-directory", "ipa", "ldap", "kerberos" or "").
type Join struct {
	Name string
	Kind string
}

// Label is how the snapshot and the Asset show it.
func (j Join) Label() string {
	switch j.Kind {
	case "":
		return j.Name
	case "active-directory":
		return "Active Directory: " + j.Name
	case "ipa":
		return "IPA: " + j.Name
	case "ldap":
		return "LDAP: " + j.Name
	default:
		return "Kerberos: " + j.Name
	}
}

// iniSections reads an INI-style file (sssd.conf, smb.conf, krb5.conf's
// [libdefaults]): section → key → value, with keys lower-cased and their
// inner spaces kept ("winbind use default domain"). # and ; start comments.
func iniSections(text string) map[string]map[string]string {
	out := map[string]map[string]string{}
	section := ""
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if line[0] == '[' {
			if end := strings.IndexByte(line, ']'); end > 0 {
				section = strings.ToLower(strings.TrimSpace(line[1:end]))
				if out[section] == nil {
					out[section] = map[string]string{}
				}
			}
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok || section == "" {
			continue
		}
		key := strings.ToLower(strings.Join(strings.Fields(k), " "))
		if _, seen := out[section][key]; !seen {
			out[section][key] = strings.TrimSpace(v)
		}
	}
	return out
}

// dnsName: a domain name as PRISM keeps it, or "" for anything else.
func dnsName(s string) string {
	s = strings.ToLower(strings.Trim(strings.TrimSpace(s), `"'.`))
	if s == "" || len(s) > 253 || !strings.Contains(s, ".") {
		return ""
	}
	for _, r := range s {
		if !(r == '.' || r == '-' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9') {
			return ""
		}
	}
	return s
}

// JoinFromRealmList reads `realm list` (realmd): the first realm.
func JoinFromRealmList(text string) Join {
	j := Join{}
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if line[0] != ' ' && line[0] != '\t' {
			if j.Name != "" {
				break
			}
			j.Name = dnsName(line)
			continue
		}
		if k, v, ok := strings.Cut(strings.TrimSpace(line), ":"); ok && strings.TrimSpace(k) == "server-software" {
			switch strings.TrimSpace(v) {
			case "active-directory", "ipa":
				j.Kind = strings.TrimSpace(v)
			}
		}
	}
	if j.Name == "" {
		return Join{}
	}
	return j
}

// JoinFromSSSD reads /etc/sssd/sssd.conf: the first of [sssd] domains, else
// the first [domain/…] section, and its id_provider.
func JoinFromSSSD(text string) Join {
	s := iniSections(text)
	var names []string
	if d := s["sssd"]["domains"]; d != "" {
		for _, n := range strings.Split(d, ",") {
			names = append(names, strings.ToLower(strings.TrimSpace(n)))
		}
	}
	for sec := range s {
		if strings.HasPrefix(sec, "domain/") {
			names = append(names, strings.TrimPrefix(sec, "domain/"))
		}
	}
	for _, n := range names {
		d, ok := s["domain/"+n]
		if !ok {
			continue
		}
		// The domain's DNS name: ad_domain or krb5_realm when the section is
		// named something else ("[domain/work]").
		name := dnsName(d["ad_domain"])
		if name == "" {
			name = dnsName(n)
		}
		if name == "" {
			name = dnsName(d["krb5_realm"])
		}
		if name == "" {
			continue
		}
		kind := ""
		switch strings.ToLower(d["id_provider"]) {
		case "ad":
			kind = "active-directory"
		case "ipa":
			kind = "ipa"
		case "ldap":
			kind = "ldap"
		}
		return Join{Name: name, Kind: kind}
	}
	return Join{}
}

// JoinFromSamba reads /etc/samba/smb.conf: an Active Directory member
// (security = ads) and its realm.
func JoinFromSamba(text string) Join {
	g := iniSections(text)["global"]
	if !strings.EqualFold(strings.TrimSpace(g["security"]), "ads") {
		return Join{}
	}
	if name := dnsName(g["realm"]); name != "" {
		return Join{Name: name, Kind: "active-directory"}
	}
	return Join{}
}

// JoinFromKerberos reads /etc/krb5.conf's default realm; only for a
// computer that holds a host keytab (it was joined; a realm alone is just
// configuration).
func JoinFromKerberos(text string, hasKeytab bool) Join {
	if !hasKeytab {
		return Join{}
	}
	if name := dnsName(iniSections(text)["libdefaults"]["default_realm"]); name != "" {
		return Join{Name: name, Kind: "kerberos"}
	}
	return Join{}
}

// FirstJoin is the first that found one.
func FirstJoin(joins ...Join) Join {
	for _, j := range joins {
		if j.Name != "" {
			return j
		}
	}
	return Join{}
}
