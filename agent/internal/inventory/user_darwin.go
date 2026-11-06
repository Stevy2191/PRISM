package inventory

import (
	"errors"
	"os"
	"os/user"
	"strconv"
	"syscall"
)

func init() { macUser = consoleUser }

// AD domain, read once per call (cheap: dsconfigad answers locally).
func macADDomain() string {
	b, err := run("/usr/sbin/dsconfigad", "-show")
	if err != nil {
		return ""
	}
	return ParseDsconfigad(string(b))
}

// MacUserFor is the person with this uid as PRISM sees them: the account
// ("RIVERSIDE\apatel" or "apatel") and their UPN when the directory or the
// account has one. Used for the console user and for the tray's socket
// peer (Task 4). nil for root and system accounts.
func MacUserFor(uid uint32) (*SignedUser, string, error) {
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		return nil, "", err
	}
	if !IsMacPerson(u.Username, uid) {
		return nil, "", nil
	}
	domain := macADDomain()
	su := &SignedUser{Account: MacAccount(u.Username, domain)}
	// One search across the local accounts and the bound directory.
	attrs := map[string]string{}
	for _, a := range []string{"dsAttrTypeNative:userPrincipalName", "EMailAddress"} {
		if b, err := run("/usr/bin/dscl", "/Search", "-read", "/Users/"+u.Username, a); err == nil {
			for k, v := range ParseDscl(string(b)) {
				attrs[k] = v
			}
		}
	}
	su.UPN = MacUPN(attrs)
	return su, domain, nil
}

// consoleUser: whoever owns /dev/console (the person at the screen); nil
// at the login window.
func consoleUser() (*SignedUser, string, error) {
	st, err := os.Stat("/dev/console")
	if err != nil {
		return nil, macADDomain(), err
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return nil, macADDomain(), errors.New("no owner for /dev/console")
	}
	su, domain, err := MacUserFor(sys.Uid)
	if su == nil && err == nil {
		domain = macADDomain()
	}
	return su, domain, err
}

// PersonFor is the person with this uid (the tray's socket peer), as
// MacUserFor gives it.
func PersonFor(uid uint32) (*SignedUser, error) {
	u, _, err := MacUserFor(uid)
	return u, err
}
