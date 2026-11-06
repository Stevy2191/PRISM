#!/bin/sh
# Builds the PRISM Agent's Linux packages for one architecture:
#   VERSION=0.6.0 ARCH=amd64 BIN=../../dist/linux-amd64 OUT=../../agent-dist sh build.sh
# BIN holds prism-agent (static) and prism-tray (cgo, WebKitGTK 4.1) for
# ARCH. Makes OUT/prism-agent-$VERSION-linux-$ARCH.{deb,rpm,pkg.tar.zst}.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${VERSION:?set VERSION}" "${ARCH:?set ARCH (amd64 or arm64)}" "${BIN:?set BIN}" "${OUT:?set OUT}"
case "$ARCH" in amd64|arm64) ;; *) echo "ARCH must be amd64 or arm64" >&2; exit 1 ;; esac
BIN=$(cd "$BIN" && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
for f in prism-agent prism-tray; do
  [ -x "$BIN/$f" ] || { echo "missing $BIN/$f" >&2; exit 1; }
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$here"/. "$work"/
render() { # version, schema
  sed -e "s|@VERSION@|$1|g" -e "s|@ARCH@|$ARCH|g" -e "s|@BIN@|$BIN|g" -e "s|^version_schema: .*|version_schema: $2|" "$here/nfpm.yaml"
}
render "$VERSION" semver > "$work/nfpm.yaml"
# Arch: nfpm drops a pre-release from pkgver unless there's an epoch, so
# give it the version with dots for the dash (0.6.0-dev.12 -> 0.6.0.dev.12,
# which pacman orders by its numbers as well). Releases are unchanged.
render "$(printf '%s' "$VERSION" | tr '-' '.')" none > "$work/nfpm-arch.yaml"
cd "$work"
for fmt in deb rpm archlinux; do
  case $fmt in deb) ext=deb; cfg=nfpm.yaml ;; rpm) ext=rpm; cfg=nfpm.yaml ;; archlinux) ext=pkg.tar.zst; cfg=nfpm-arch.yaml ;; esac
  nfpm package --config "$cfg" --packager "$fmt" --target "$OUT/prism-agent-$VERSION-linux-$ARCH.$ext"
done
ls -l "$OUT"/prism-agent-"$VERSION"-linux-"$ARCH".*
