package update

import (
	"reflect"
	"testing"
)

func TestTheMacInstallerRunsOnlyTheCheckedFile(t *testing.T) {
	got := installCommand("/Library/Application Support/PRISM/updates/prism-agent-0.7.0.pkg")
	want := []string{"/usr/sbin/installer", "-pkg", "/Library/Application Support/PRISM/updates/prism-agent-0.7.0.pkg", "-target", "/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%v", got)
	}
	if PlatformInstall == nil {
		t.Fatal("no installer on macOS")
	}
}
