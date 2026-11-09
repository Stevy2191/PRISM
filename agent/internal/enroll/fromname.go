package enroll

// An install link's installer carries its enrollment in its file name
// (plan 8d): PRISM-Agent-Setup_<host>_<key>.msi or .pkg, a port written as
// "+<port>". The installer passes its own path; the name is untrusted
// input, so only exactly that shape is accepted and nothing from it reaches
// a shell.

import (
	"errors"
	"path/filepath"
	"regexp"
	"strings"
)

const setupPrefix = "PRISM-Agent-Setup_"

var (
	// A browser's " (1)" or "(1)" for a second download of the same name.
	dupSuffix = regexp.MustCompile(`\s*\(\d{1,3}\)$`)
	keyShape  = regexp.MustCompile(`^pk_enr_[A-Za-z0-9_-]{43}$`)
	hostShape = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*(\+[0-9]{1,5})?$`)
)

// ErrNoEnrollmentInName: the installer's name carries no enrollment (an
// installer downloaded by staff, or renamed): install without enrolling.
var ErrNoEnrollmentInName = errors.New("the installer's name carries no enrollment")

// FromInstallerName reads PRISM's address and the install key from an
// installer's path. → ("https://host[:port]", key) or ErrNoEnrollmentInName.
func FromInstallerName(path string) (string, string, error) {
	if len(path) > 1024 {
		return "", "", ErrNoEnrollmentInName
	}
	// Either separator: the Mac passes a / path, Windows a \ one, and tests
	// run everywhere.
	name := path
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	if len(name) > 255 {
		return "", "", ErrNoEnrollmentInName
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".msi" && ext != ".pkg" {
		return "", "", ErrNoEnrollmentInName
	}
	name = dupSuffix.ReplaceAllString(name[:len(name)-len(ext)], "")
	if !strings.HasPrefix(name, setupPrefix) {
		return "", "", ErrNoEnrollmentInName
	}
	rest := name[len(setupPrefix):]
	i := strings.Index(rest, "_pk_enr_")
	if i <= 0 {
		return "", "", ErrNoEnrollmentInName
	}
	host, key := rest[:i], rest[i+1:]
	if !hostShape.MatchString(host) || len(host) > 253 || !keyShape.MatchString(key) {
		return "", "", ErrNoEnrollmentInName
	}
	hostPort := strings.Replace(host, "+", ":", 1)
	scheme := "https://"
	// This computer only (CheckURL's own exception): how the CI tests run a
	// renamed installer against a local stub PRISM.
	if name := strings.SplitN(hostPort, ":", 2)[0]; name == "localhost" || name == "127.0.0.1" {
		scheme = "http://"
	}
	base, err := CheckURL(scheme + hostPort)
	if err != nil {
		return "", "", ErrNoEnrollmentInName
	}
	return base, key, nil
}
