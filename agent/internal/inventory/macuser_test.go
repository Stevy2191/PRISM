package inventory

import "testing"

func TestMacPeople(t *testing.T) {
	for _, c := range []struct {
		name string
		uid  uint32
		want bool
	}{
		{"apatel", 501, true}, {"maria.chen", 1105, true}, {"root", 0, false}, {"_mbsetupuser", 248, false},
		{"loginwindow", 501, false}, {"_spotlight", 501, false}, {"../admin", 501, false}, {"a/b", 501, false},
	} {
		if got := IsMacPerson(c.name, c.uid); got != c.want {
			t.Errorf("IsMacPerson(%q, %d) = %v", c.name, c.uid, got)
		}
	}
}

const dsconfigadBound = `Active Directory Forest          = riverside.local
Active Directory Domain          = Riverside.local
Computer Account                 = rfc-mac-07$

Advanced Options - User Experience
  Create mobile account at login = Enabled
`

func TestDirectoryBinding(t *testing.T) {
	if d := ParseDsconfigad(dsconfigadBound); d != "riverside.local" {
		t.Fatalf("domain %q", d)
	}
	if d := ParseDsconfigad(""); d != "" {
		t.Fatalf("unbound gave %q", d)
	}
	if a := MacAccount("apatel", "riverside.local"); a != `RIVERSIDE\apatel` {
		t.Fatalf("account %q", a)
	}
	if a := MacAccount("apatel", ""); a != "apatel" {
		t.Fatalf("account %q", a)
	}
}

func TestDsclAndTheUPN(t *testing.T) {
	bound := ParseDscl("dsAttrTypeNative:userPrincipalName:\n anika.patel@riversideclinic.org\n")
	if MacUPN(bound) != "anika.patel@riversideclinic.org" {
		t.Fatalf("continuation line: %v", bound)
	}
	local := ParseDscl("EMailAddress: apatel@example.org\n")
	if MacUPN(local) != "apatel@example.org" {
		t.Fatalf("local email: %v", local)
	}
	// Not an address, or nothing at all: no UPN, so the placeholder.
	if MacUPN(ParseDscl("EMailAddress: Anika Patel\n")) != "" || MacUPN(map[string]string{}) != "" {
		t.Fatal("accepted a non-address")
	}
	// The directory's UPN wins over a local email.
	both := map[string]string{"EMailAddress": "home@example.com", "dsAttrTypeNative:userPrincipalName": "anika.patel@riversideclinic.org"}
	if MacUPN(both) != "anika.patel@riversideclinic.org" {
		t.Fatal("the UPN didn't win")
	}
}
