#!/bin/bash
# Builds the PRISM Agent .pkg for macOS (plan 8b, Task 8), on a Mac with
# Xcode's command-line tools. Universal (Apple silicon and Intel), ad-hoc
# signed; Developer ID signing and notarisation when the environment has
# them (see agent.yml).
#
#   VERSION=0.6.0 agent/packaging/macos/build.sh <out-dir>
#
# Installs:
#   /Library/Application Support/PRISM/bin/prism-agent  (+ /usr/local/bin link)
#   /Applications/Utilities/PRISM Agent.app             (the menu-bar app)
#   /Library/LaunchDaemons/com.prism.agent.plist        (the service, root)
#   /Library/LaunchAgents/com.prism.tray.plist          (the menu bar, per user)
set -euo pipefail

: "${VERSION:?set VERSION}"
OUT="${1:?usage: build.sh <out-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

export MACOSX_DEPLOYMENT_TARGET=13.0
export CGO_ENABLED=1
LD="-s -w -X github.com/stevy2191/prism/agent/internal/version.Version=${VERSION}"

for arch in arm64 amd64; do
  clangarch=$([ "$arch" = amd64 ] && echo x86_64 || echo arm64)
  export CC="clang -arch $clangarch -mmacosx-version-min=13.0"
  (cd "$AGENT" && GOOS=darwin GOARCH=$arch go build -trimpath -ldflags "$LD" -o "$WORK/$arch/prism-agent" ./cmd/prism-agent)
  (cd "$AGENT" && GOOS=darwin GOARCH=$arch go build -trimpath -ldflags "$LD" -o "$WORK/$arch/prism-tray" ./cmd/prism-tray)
done

ROOT="$WORK/root"
BIN="$ROOT/Library/Application Support/PRISM/bin"
APP="$ROOT/Applications/Utilities/PRISM Agent.app"
mkdir -p "$BIN" "$APP/Contents/MacOS" "$ROOT/Library/LaunchDaemons" "$ROOT/Library/LaunchAgents"
lipo -create -output "$BIN/prism-agent" "$WORK/arm64/prism-agent" "$WORK/amd64/prism-agent"
lipo -create -output "$APP/Contents/MacOS/prism-tray" "$WORK/arm64/prism-tray" "$WORK/amd64/prism-tray"
# The bundle's version: the release's numbers (CFBundleShortVersionString
# takes x.y.z; a dev build's run number goes in CFBundleVersion).
short="${VERSION%%-*}"
if [ "$short" != "$VERSION" ]; then build="${VERSION##*.}"; else build="$short"; fi
sed -e "s/__VERSION__/$short/" -e "s/__BUILD__/$build/" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
cp "$HERE/com.prism.agent.plist" "$ROOT/Library/LaunchDaemons/"
cp "$HERE/com.prism.tray.plist" "$ROOT/Library/LaunchAgents/"

# Signing: a Developer ID when there is one (hardened runtime, timestamp),
# else ad hoc (Apple silicon won't run unsigned code).
IDENT="${APPLE_DEVELOPER_ID_APP:--}"
SIGNARGS=(--force --options runtime -s "$IDENT")
[ "$IDENT" != "-" ] && SIGNARGS+=(--timestamp)
codesign "${SIGNARGS[@]}" "$BIN/prism-agent"
codesign "${SIGNARGS[@]}" "$APP/Contents/MacOS/prism-tray"
codesign "${SIGNARGS[@]}" "$APP"
lipo -info "$BIN/prism-agent" | grep -q "x86_64 arm64\|arm64 x86_64"
lipo -info "$APP/Contents/MacOS/prism-tray" | grep -q "x86_64 arm64\|arm64 x86_64"

chmod 0755 "$BIN/prism-agent" "$APP/Contents/MacOS/prism-tray"
chmod 0644 "$ROOT/Library/LaunchDaemons/com.prism.agent.plist" "$ROOT/Library/LaunchAgents/com.prism.tray.plist"
chmod 0755 "$HERE/scripts/preinstall" "$HERE/scripts/postinstall"

pkgbuild --root "$ROOT" --identifier com.prism.agent --version "$VERSION" \
  --install-location / --scripts "$HERE/scripts" --ownership recommended \
  "$WORK/prism-agent-component.pkg"
sed -e "s/__VERSION__/$VERSION/" "$HERE/distribution.xml" > "$WORK/distribution.xml"
PKG="$OUT/prism-agent-${VERSION}-macos-universal.pkg"
productbuild --distribution "$WORK/distribution.xml" --package-path "$WORK" "$WORK/unsigned.pkg"

if [ -n "${APPLE_DEVELOPER_ID_INSTALLER:-}" ]; then
  productsign --sign "$APPLE_DEVELOPER_ID_INSTALLER" --timestamp "$WORK/unsigned.pkg" "$PKG"
  if [ -n "${APPLE_NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$PKG" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait
    xcrun stapler staple "$PKG"
  fi
else
  cp "$WORK/unsigned.pkg" "$PKG"
fi
echo "Built $PKG"
