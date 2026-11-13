package inventory

import "testing"

func TestParseNetshWlan(t *testing.T) {
	out := "\r\nThere is 1 interface on the system:\r\n\r\n    Name                   : Wi-Fi\r\n    State                  : connected\r\n    SSID                   : Clinic-Staff\r\n    BSSID                  : aa:bb:cc:dd:ee:ff\r\n    Signal                 : 62%\r\n"
	if got := ParseNetshWlan(out); got != `Wi-Fi "Clinic-Staff", signal 62%` {
		t.Fatalf("got %q", got)
	}
	if got := ParseNetshWlan("    State                  : disconnected\r\n"); got != "" {
		t.Fatalf("disconnected: %q", got)
	}
	if got := ParseNetshWlan("The Wireless AutoConfig Service (wlansvc) is not running."); got != "" {
		t.Fatalf("no wifi: %q", got)
	}
}

func TestBatteryLine(t *testing.T) {
	cases := []struct {
		pct          int
		ac           bool
		full, design uint64
		want         string
	}{
		{81, true, 40500, 50000, "81% charged, on charger, health 81%"},
		{40, false, 0, 0, "40% charged, on battery"},
		{100, true, 52000, 50000, "100% charged, on charger, health 100%"},
		{255, false, 1, 1, ""},
	}
	for _, c := range cases {
		if got := BatteryLine(c.pct, c.ac, c.full, c.design); got != c.want {
			t.Errorf("BatteryLine(%d): %q, want %q", c.pct, got, c.want)
		}
	}
}

func TestAntivirusState(t *testing.T) {
	// Microsoft Defender's usual values.
	for state, want := range map[uint32]string{397568: "on, up to date", 397584: "on, out of date", 393472: "off"} {
		if got := AntivirusState(state); got != want {
			t.Errorf("AntivirusState(%d) = %q, want %q", state, got, want)
		}
	}
}

func TestMacBattery(t *testing.T) {
	batt := "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t81%; charging; 0:42 remaining present: true\n"
	if got := ParsePmsetBatt(batt); got != "81% charged, on charger" {
		t.Fatalf("got %q", got)
	}
	if got := ParsePmsetBatt("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t55%; discharging; 3:10 remaining present: true\n"); got != "55% charged, on battery" {
		t.Fatalf("got %q", got)
	}
	if got := ParsePmsetBatt("Now drawing from 'AC Power'\n"); got != "" {
		t.Fatalf("desktop: %q", got)
	}
	sp := "Power:\n    Battery Information:\n      Health Information:\n          Cycle Count: 312\n          Condition: Service Recommended\n          Maximum Capacity: 79%\n"
	if got := ParseMacBatteryHealth(sp); got != "health 79%, condition: Service Recommended" {
		t.Fatalf("got %q", got)
	}
	if got := ParseMacBatteryHealth("          Condition: Normal\n          Maximum Capacity: 96%\n"); got != "health 96%" {
		t.Fatalf("got %q", got)
	}
}

func TestEncryptionLines(t *testing.T) {
	if ParseFdesetup("FileVault is On.\n") != "FileVault on" || ParseFdesetup("FileVault is Off.\n") != "FileVault off" || ParseFdesetup("") != "" {
		t.Fatal("fdesetup")
	}
	if !HasCryptVolume("disk\npart\ncrypt\nlvm\n") || HasCryptVolume("disk\npart\n") {
		t.Fatal("lsblk")
	}
	if BitLockerLine(1) != "BitLocker on" || BitLockerLine(0) != "BitLocker off" || BitLockerLine(2) != "" {
		t.Fatal("bitlocker")
	}
}

func TestAddLineSkipsEmpty(t *testing.T) {
	l := addLine(nil, "Battery", "")
	l = addLine(l, "Network", "  Wired ")
	if len(l) != 1 || l[0].Value != "Wired" {
		t.Fatalf("%+v", l)
	}
}
