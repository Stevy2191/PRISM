package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
)

// trayIcon is the notification-area icon: PRISM's blue rounded square with
// a white P, as an .ico holding a 32×32 PNG (Windows scales it).
func trayIcon() []byte {
	const n = 32
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	blue := color.NRGBA{0x24, 0x48, 0xC9, 0xFF}
	white := color.NRGBA{0xFF, 0xFF, 0xFF, 0xFF}
	r := 7
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			// Rounded corners: outside a corner's circle stays transparent.
			cx, cy := x, y
			if cx < r {
				cx = r
			} else if cx > n-1-r {
				cx = n - 1 - r
			}
			if cy < r {
				cy = r
			} else if cy > n-1-r {
				cy = n - 1 - r
			}
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r {
				img.Set(x, y, blue)
			}
		}
	}
	fill := func(x0, y0, x1, y1 int) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				img.Set(x, y, white)
			}
		}
	}
	// The P: a stem and a bowl.
	fill(10, 7, 14, 25)
	fill(14, 7, 20, 10)
	fill(14, 15, 20, 18)
	fill(19, 9, 23, 16)
	var p bytes.Buffer
	_ = png.Encode(&p, img)
	var ico bytes.Buffer
	w := func(v any) { _ = binary.Write(&ico, binary.LittleEndian, v) }
	w(uint16(0))
	w(uint16(1)) // icon
	w(uint16(1)) // one image
	ico.Write([]byte{n, n, 0, 0})
	w(uint16(1))  // planes
	w(uint16(32)) // bits
	w(uint32(p.Len()))
	w(uint32(6 + 16))
	ico.Write(p.Bytes())
	return ico.Bytes()
}
