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
func trayIcon(dot bool) []byte {
	const n = 32
	p := trayPNG(dot)
	var ico bytes.Buffer
	w := func(v any) { _ = binary.Write(&ico, binary.LittleEndian, v) }
	w(uint16(0))
	w(uint16(1)) // icon
	w(uint16(1)) // one image
	ico.Write([]byte{n, n, 0, 0})
	w(uint16(1))  // planes
	w(uint16(32)) // bits
	w(uint32(len(p)))
	w(uint32(6 + 16))
	ico.Write(p)
	return ico.Bytes()
}

// trayPNG is the same icon as a PNG (Linux's StatusNotifierItem takes one).
func trayPNG(dot bool) []byte {
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
	if dot {
		// Something new from the help desk: an amber dot with a white ring,
		// top right, readable on a light or dark taskbar.
		disc(img, 24, 7, 8, white)
		disc(img, 24, 7, 6, color.NRGBA{0xF5, 0x9E, 0x0B, 0xFF})
	}
	var p bytes.Buffer
	_ = png.Encode(&p, img)
	return p.Bytes()
}

// trayTemplateIcon is the Mac menu-bar icon: a black P on transparent, as a
// PNG. macOS treats it as a template (it uses only the shape and draws it
// to suit the menu bar). 36×36 for sharp Retina rendering at 18 points.
func trayTemplateIcon(dot bool) []byte {
	const n = 36
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	ink := color.NRGBA{0, 0, 0, 0xFF}
	fill := func(x0, y0, x1, y1 int) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				img.Set(x, y, ink)
			}
		}
	}
	// A rounded square outline with the P inside, like the Windows icon.
	fill(4, 4, 32, 7)
	fill(4, 29, 32, 32)
	fill(4, 4, 7, 32)
	fill(29, 4, 32, 32)
	fill(12, 10, 16, 27)
	fill(16, 10, 22, 13)
	fill(16, 17, 22, 20)
	fill(21, 12, 25, 18)
	if dot {
		// A template icon has one ink: clear a ring, then a solid dot.
		disc(img, 28, 8, 9, color.NRGBA{})
		disc(img, 28, 8, 6, ink)
	}
	var p bytes.Buffer
	_ = png.Encode(&p, img)
	return p.Bytes()
}

// disc fills a circle (c with alpha 0 clears it).
func disc(img *image.NRGBA, cx, cy, r int, c color.NRGBA) {
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r && image.Pt(x, y).In(img.Rect) {
				img.SetNRGBA(x, y, c)
			}
		}
	}
}
