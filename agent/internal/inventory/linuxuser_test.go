package inventory

import "testing"

const loginctlSessions = `     2 1000 maria seat0 tty2
    c1  120 gdm   seat0 tty1
    14 1000 maria       pts/1
`

func TestLinuxDesktopSession(t *testing.T) {
	ids := ParseSessionIDs(loginctlSessions)
	if len(ids) != 3 || ids[0] != "2" || ids[1] != "c1" {
		t.Fatalf("ids %v", ids)
	}
	desktop := ParseKeyValues("Name=maria\nUser=1000\nActive=yes\nType=wayland\nRemote=no\nClass=user\n")
	if !IsDesktopSession(desktop) || desktop["User"] != "1000" {
		t.Fatalf("desktop %v", desktop)
	}
	for _, s := range []string{
		"Active=yes\nType=wayland\nRemote=no\nClass=greeter\n", // the login screen (gdm)
		"Active=yes\nType=tty\nRemote=yes\nClass=user\n",       // ssh
		"Active=no\nType=x11\nRemote=no\nClass=user\n",         // switched away
		"Active=yes\nType=tty\nRemote=no\nClass=user\n",        // a text console
	} {
		if IsDesktopSession(ParseKeyValues(s)) {
			t.Errorf("not a desktop session, but accepted: %q", s)
		}
	}
}

func TestLinuxPeople(t *testing.T) {
	for _, c := range []struct {
		name string
		uid  uint32
		want bool
	}{
		{"maria", 1000, true}, {"maria@riverside.local", 1450201105, true}, {"root", 0, false}, {"gdm", 120, false},
		{"nobody", 65534, false}, {"-x", 1001, false}, {"a/b", 1001, false},
	} {
		if got := IsLinuxPerson(c.name, c.uid); got != c.want {
			t.Errorf("IsLinuxPerson(%q, %d) = %v", c.name, c.uid, got)
		}
	}
	if ParseGetentPasswd("maria@riverside.local:*:1450201105:1450200513:Maria Chen:/home/maria@riverside.local:/bin/bash\n") != "maria@riverside.local" {
		t.Fatal("getent")
	}
}

func TestLinuxRealmAndAccount(t *testing.T) {
	if r := ParseRealmList("Riverside.local\n"); r != "riverside.local" {
		t.Fatalf("realm %q", r)
	}
	if ParseRealmList("") != "" {
		t.Fatal("no realm")
	}
	// SSSD's fully qualified names.
	if u := LinuxPerson("maria@riverside.local", "riverside.local"); u.Account != `RIVERSIDE\maria` || u.UPN != "maria@riverside.local" {
		t.Fatalf("fq %+v", u)
	}
	// Short names on a joined computer.
	if u := LinuxPerson("maria", "riverside.local"); u.Account != `RIVERSIDE\maria` || u.UPN != "maria@riverside.local" {
		t.Fatalf("short %+v", u)
	}
	// Not joined: the plain name and no UPN (the placeholder).
	if u := LinuxPerson("maria", ""); u.Account != "maria" || u.UPN != "" {
		t.Fatalf("local %+v", u)
	}
}

func TestWinbindNames(t *testing.T) {
	for _, name := range []string{`RIVERSIDE\maria`, "RIVERSIDE+maria"} {
		if !IsLinuxPerson(name, 10001105) {
			t.Fatalf("%q refused", name)
		}
		if u := LinuxPerson(name, "riverside.local"); u.Account != `RIVERSIDE\maria` || u.UPN != "maria@riverside.local" {
			t.Fatalf("%q with a realm: %+v", name, u)
		}
		if u := LinuxPerson(name, ""); u.Account != `RIVERSIDE\maria` || u.UPN != "" {
			t.Fatalf("%q without a realm: %+v", name, u)
		}
	}
	for _, name := range []string{`\maria`, `-x\y`, "a/b", `RIVERSIDE\`} {
		if IsLinuxPerson(name, 10001105) && LinuxPerson(name, "").Account == "" {
			t.Fatalf("%q", name)
		}
	}
	if IsLinuxPerson(`\maria`, 1001) || IsLinuxPerson("-x", 1001) {
		t.Fatal("a name that starts with a separator or a dash")
	}
}
