package inventory

import (
	"os"
	"os/user"
	"strconv"
	"strings"
)

// linuxJoin: the directory this computer is joined to (linuxjoin.go):
// realmd, then SSSD's and Samba's configuration, then a Kerberos realm with
// a host keytab. The service runs as root, so sssd.conf (0600) is readable.
func linuxJoin() Join {
	realmd := Join{}
	if b, err := run("realm", "list"); err == nil {
		realmd = JoinFromRealmList(string(b))
	}
	_, keytabErr := os.Stat("/etc/krb5.keytab")
	return FirstJoin(
		realmd,
		JoinFromSSSD(readFile("/etc/sssd/sssd.conf")),
		JoinFromSamba(readFile("/etc/samba/smb.conf")),
		JoinFromKerberos(readFile("/etc/krb5.conf"), keytabErr == nil),
	)
}

// realm: the joined directory's DNS name, or "".
func realm() string { return linuxJoin().Name }

// nameFor: the account name for a uid. The service is a static binary,
// whose own lookup reads only /etc/passwd; directory users (SSSD) come from
// getent, which asks the system's name service.
func nameFor(uid uint32) (string, error) {
	if u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10)); err == nil {
		return u.Username, nil
	}
	b, err := run("getent", "passwd", strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		return "", err
	}
	return ParseGetentPasswd(string(b)), nil
}

// PersonFor is the person with this uid (the tray's socket peer); nil for
// root and system accounts.
func PersonFor(uid uint32) (*SignedUser, error) {
	name, err := nameFor(uid)
	if err != nil {
		return nil, err
	}
	if !IsLinuxPerson(name, uid) {
		return nil, nil
	}
	return LinuxPerson(name, realm()), nil
}

// desktopUser: the person in the active local graphical session (systemd's
// logind), or nil (a server, or the login screen). Also the realm.
func desktopUser() (*SignedUser, string, error) {
	r := realm()
	b, err := run("loginctl", "list-sessions", "--no-legend")
	if err != nil {
		return nil, r, err
	}
	for _, id := range ParseSessionIDs(string(b)) {
		if !linuxUsername.MatchString(id) {
			continue
		}
		out, err := run("loginctl", "show-session", id, "-p", "Active", "-p", "Type", "-p", "Remote", "-p", "Class", "-p", "User", "-p", "Name")
		if err != nil {
			continue
		}
		p := ParseKeyValues(string(out))
		if !IsDesktopSession(p) {
			continue
		}
		uid, err := strconv.ParseUint(strings.TrimSpace(p["User"]), 10, 32)
		if err != nil {
			continue
		}
		u, err := PersonFor(uint32(uid))
		return u, r, err
	}
	return nil, r, nil
}
