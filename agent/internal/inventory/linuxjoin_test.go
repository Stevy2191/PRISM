package inventory

import "testing"

const sssdConf = `
[sssd]
services = nss, pam
domains = riverside.local

[domain/riverside.local]
id_provider = ad
access_provider = ad
# a comment
`

const smbConf = `
[global]
   workgroup = RIVERSIDE
   security = ADS
   realm = RIVERSIDE.LOCAL
   winbind use default domain = yes
   winbind separator = +
`

func TestLinuxJoinSources(t *testing.T) {
	cases := []struct {
		name string
		got  Join
		want string
	}{
		{"realmd", JoinFromRealmList("riverside.local\n  type: kerberos\n  server-software: active-directory\n"), "Active Directory: riverside.local"},
		{"realmd ipa", JoinFromRealmList("corp.example.com\n  server-software: ipa\n"), "IPA: corp.example.com"},
		{"sssd", JoinFromSSSD(sssdConf), "Active Directory: riverside.local"},
		{"sssd named section", JoinFromSSSD("[sssd]\ndomains = work\n[domain/work]\nid_provider = ad\nad_domain = Riverside.Local\n"), "Active Directory: riverside.local"},
		{"sssd ldap", JoinFromSSSD("[domain/corp.example.com]\nid_provider = ldap\n"), "LDAP: corp.example.com"},
		{"samba", JoinFromSamba(smbConf), "Active Directory: riverside.local"},
		{"kerberos", JoinFromKerberos("[libdefaults]\n default_realm = RIVERSIDE.LOCAL\n", true), "Kerberos: riverside.local"},
	}
	for _, c := range cases {
		if c.got.Label() != c.want {
			t.Errorf("%s: %q, want %q", c.name, c.got.Label(), c.want)
		}
	}
}

func TestLinuxJoinRefusals(t *testing.T) {
	for name, j := range map[string]Join{
		"realm list empty":        JoinFromRealmList(""),
		"samba not a member":      JoinFromSamba("[global]\nsecurity = user\nrealm = RIVERSIDE.LOCAL\n"),
		"samba no realm":          JoinFromSamba("[global]\nsecurity = ads\n"),
		"sssd local only":         JoinFromSSSD("[sssd]\ndomains = local\n[domain/local]\nid_provider = files\n"),
		"kerberos without keytab": JoinFromKerberos("[libdefaults]\ndefault_realm = RIVERSIDE.LOCAL\n", false),
		"junk name":               JoinFromSamba("[global]\nsecurity = ads\nrealm = $(reboot).x\n"),
	} {
		if j.Name != "" {
			t.Errorf("%s: found %+v", name, j)
		}
	}
	if j := FirstJoin(Join{}, JoinFromSamba(smbConf), JoinFromSSSD(sssdConf)); j.Name != "riverside.local" || j.Kind != "active-directory" {
		t.Fatalf("first: %+v", j)
	}
}
