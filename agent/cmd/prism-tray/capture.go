//go:build windows || (darwin && cgo) || (linux && cgo)

package main

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"time"
)

// Capture my screen (owner, 2026-11-13): one click in the form hides the
// window, takes a picture of the screen and attaches it. Each platform has
// captureScreen (capture_*.go); this file is what they share.

// maxShot is the form's limit for one attached file (10 MB), with room.
const maxShot = 9 << 20

var errNoCapture = errors.New("This computer can't take a picture of the screen. Attach a file instead.")

// encodeShot is the picture as a PNG, or as a JPEG when the PNG would be
// too large to attach (several large screens).
func encodeShot(img image.Image) (data []byte, mime, ext string, err error) {
	var b bytes.Buffer
	if err = png.Encode(&b, img); err == nil && b.Len() <= maxShot {
		return b.Bytes(), "image/png", "png", nil
	}
	b.Reset()
	if err = jpeg.Encode(&b, img, &jpeg.Options{Quality: 80}); err != nil {
		return nil, "", "", err
	}
	if b.Len() > maxShot {
		return nil, "", "", errors.New("The picture of the screen is too large to attach.")
	}
	return b.Bytes(), "image/jpeg", "jpg", nil
}

// shotFromTool runs a system tool that writes a PNG to a path we choose in
// the user's own temporary folder, and reads it back.
func shotFromTool(run func(path string) error) ([]byte, string, string, error) {
	dir, err := os.MkdirTemp("", "prism-shot-")
	if err != nil {
		return nil, "", "", err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "screen.png")
	if err := run(path); err != nil {
		return nil, "", "", err
	}
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return nil, "", "", errNoCapture
	}
	if len(b) <= maxShot {
		return b, "image/png", "png", nil
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, "", "", errors.New("The picture of the screen is too large to attach.")
	}
	return encodeShot(img)
}

// shotName is the attachment's name, with the time it was taken.
func shotName(ext string) string {
	return "Screen " + time.Now().Format("2006-01-02 15.04.05") + "." + ext
}
