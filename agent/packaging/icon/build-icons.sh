#!/bin/bash
# Rebuilds the PRISM app icon files from the two SVGs (owner, 2026-11-22).
# Run after changing prism.svg or prism-macos.svg, and commit what it writes:
#   prism.ico                 Windows (the MSI installs it; the Start menu
#                             shortcut, Add/Remove Programs and the window use it)
#   prism.icns                macOS (PRISM Agent.app and Help desk.app)
#   ../linux/prism-agent.svg  Linux (the app list; a copy of prism.svg)
# Needs Node with Playwright (Chromium) and Python with Pillow.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
node "$HERE/rasterize.cjs" "$HERE/prism.svg" "$WORK/win" 16 20 24 32 40 48 64 96 128 256
node "$HERE/rasterize.cjs" "$HERE/prism-macos.svg" "$WORK/mac" 16 32 64 128 256 512 1024
python3 "$HERE/pack.py" ico "$WORK/win" "$HERE/prism.ico"
python3 "$HERE/pack.py" icns "$WORK/mac" "$HERE/prism.icns"
cp "$HERE/prism.svg" "$HERE/../linux/prism-agent.svg"
