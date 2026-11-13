//go:build linux && cgo

package main

/*
#cgo pkg-config: gtk+-3.0
#include <gtk/gtk.h>

static void prismHide(void *w) { if (w) gtk_widget_hide(GTK_WIDGET(w)); }
static void prismShow(void *w) { if (w) { gtk_widget_show(GTK_WIDGET(w)); gtk_window_present(GTK_WINDOW(w)); } }
*/
import "C"

import (
	"context"
	"os"
	"os/exec"
	"time"
)

// The desktop's own screenshot tool, whichever is installed: there is no
// one way to read the screen on Linux (X11 and Wayland differ).
var shotTools = [][]string{
	{"/usr/bin/gnome-screenshot", "-f"},
	{"/usr/bin/grim"},
	{"/usr/bin/spectacle", "-b", "-n", "-o"},
	{"/usr/bin/scrot", "-o"},
	{"/usr/bin/import", "-window", "root"},
}

func shotTool() []string {
	for _, t := range shotTools {
		if st, err := os.Stat(t[0]); err == nil && st.Mode().IsRegular() {
			return t
		}
	}
	return nil
}

func canCapture() bool { return shotTool() != nil }

func hideWindow(w window) { C.prismHide(w.Window()) }
func showWindow(w window) { C.prismShow(w.Window()) }

func captureScreen() ([]byte, string, string, error) {
	tool := shotTool()
	if tool == nil {
		return nil, "", "", errNoCapture
	}
	return shotFromTool(func(path string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, tool[0], append(append([]string{}, tool[1:]...), path)...).Run()
	})
}
