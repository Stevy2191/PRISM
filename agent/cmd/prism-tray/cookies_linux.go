//go:build linux && cgo

package main

/*
#cgo pkg-config: gtk+-3.0 webkit2gtk-4.0
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdlib.h>

// The web view is the window's only child (webview_go adds it directly).
static int prism_keep_cookies(void *win, const char *file) {
	GtkWidget *child = gtk_bin_get_child(GTK_BIN(win));
	if (!child || !WEBKIT_IS_WEB_VIEW(child)) return 0;
	WebKitWebContext *ctx = webkit_web_view_get_context(WEBKIT_WEB_VIEW(child));
	WebKitCookieManager *cm = webkit_web_context_get_cookie_manager(ctx);
	webkit_cookie_manager_set_persistent_storage(cm, file, WEBKIT_COOKIE_PERSISTENT_STORAGE_SQLITE);
	return 1;
}
*/
import "C"

import (
	"log"
	"os"
	"path/filepath"
	"unsafe"
)

// keepSignIn: WebKitGTK keeps cookies only in memory unless told where to
// keep them, so the portal's sign-in in Past tickets would last only while
// the window is open. This keeps them in the person's own folder.
func keepSignIn(w window, dir string) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	file := C.CString(filepath.Join(dir, "cookies.sqlite"))
	defer C.free(unsafe.Pointer(file))
	if C.prism_keep_cookies(w.Window(), file) == 0 {
		log.Print("prism-tray: Past tickets can't keep the portal sign-in (no web view found)")
	}
}
