package enroll

import (
	"strings"
	"testing"
)

const testKey = "pk_enr_Ab3-_x9QpLmN0rStUvWxYz012345678901234567890"

func TestFromInstallerName(t *testing.T) {
	if len(testKey) != len("pk_enr_")+43 {
		t.Fatalf("test key is %d long", len(testKey))
	}
	good := map[string]string{
		`C:\Users\amy\Downloads\PRISM-Agent-Setup_prism.example.com_` + testKey + `.msi`:     "https://prism.example.com",
		`C:\Users\amy\Downloads\PRISM-Agent-Setup_prism.example.com_` + testKey + ` (1).msi`: "https://prism.example.com",
		"/Users/amy/Downloads/PRISM-Agent-Setup_prism.example.com+8443_" + testKey + ".pkg":  "https://prism.example.com:8443",
		"/Users/amy/Downloads/PRISM-Agent-Setup_prism.example.com_" + testKey + "(2).PKG":    "https://prism.example.com",
		"PRISM-Agent-Setup_localhost_" + testKey + ".msi":                                    "http://localhost",
		"PRISM-Agent-Setup_127.0.0.1+8765_" + testKey + ".pkg":                               "http://127.0.0.1:8765",
	}
	for path, want := range good {
		base, key, err := FromInstallerName(path)
		if err != nil || base != want || key != testKey {
			t.Errorf("%s: %q %q %v", path, base, key, err)
		}
	}
	bad := []string{
		"prism-agent-0.6.0-windows-amd64.msi",                                        // downloaded by staff
		"PRISM-Agent-Setup_prism.example.com_" + testKey + ".exe",                    // not an installer
		"PRISM-Agent-Setup_prism.example.com_" + testKey[:20] + ".msi",               // short key
		"PRISM-Agent-Setup__" + testKey + ".msi",                                     // no host
		"PRISM-Agent-Setup_prism.example.com/evil_" + testKey + ".msi",               // a path in the host
		"PRISM-Agent-Setup_user@prism.example.com_" + testKey + ".msi",               // userinfo
		"PRISM-Agent-Setup_prism example.com_" + testKey + ".msi",                    // space
		"PRISM-Agent-Setup_https+prism.example.com_" + testKey + ".msi",              // scheme
		"PRISM-Agent-Setup_prism.example.com+99999999_" + testKey + ".msi",           // port too long
		"PRISM-Agent-Setup_prism.example.com_" + testKey + "x.msi",                   // key too long
		"PRISM-Agent-Setup_-bad.example.com_" + testKey + ".msi",                     // label starts with -
		"PRISM-Agent-Setup_prism.example.com_" + testKey + `;calc.msi`,               // junk
		"PRISM-Agent-Setup_" + strings.Repeat("a.", 130) + "com_" + testKey + ".msi", // too long
		"",
	}
	for _, path := range bad {
		if base, key, err := FromInstallerName(path); err == nil {
			t.Errorf("%q accepted: %q %q", path, base, key)
		}
	}
}
