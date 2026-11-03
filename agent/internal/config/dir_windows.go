package config

import (
	"os"
	"path/filepath"
)

// C:\ProgramData\PRISM
func defaultDir() string {
	base := os.Getenv("ProgramData")
	if base == "" {
		base = `C:\ProgramData`
	}
	return filepath.Join(base, "PRISM")
}
