#!/bin/sh
# Checks frontend/nginx.conf in the image the frontend ships in (nginx:1.27-alpine):
# client-side routes load the app on a hard refresh (including /assets, which
# shares its name with the build's assets/ folder), hashed files are served
# with caching, and the hardening headers are on every response.
# Usage: sh frontend/scripts/check-nginx.sh   (needs docker)
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
site=$(mktemp -d)
trap 'docker rm -f prism-nginx-check >/dev/null 2>&1 || true; rm -rf "$site"' EXIT
mkdir -p "$site/assets"
echo '<!doctype html><title>app</title>' > "$site/index.html"
echo 'console.log(1)' > "$site/assets/index-abc123.js"
chmod -R a+rX "$site"
docker run -d --rm --name prism-nginx-check --add-host backend:127.0.0.1 -p 127.0.0.1:18089:80 \
  -v "$here/nginx.conf:/etc/nginx/conf.d/default.conf:ro" -v "$site:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://127.0.0.1:18089/ && break; sleep 0.5; done

fail=0
check() { # name, path, expected status, [header that must be present]
  out=$(curl -s -o /dev/null -D - "http://127.0.0.1:18089$2")
  code=$(printf '%s' "$out" | head -1 | awk '{print $2}')
  if [ "$code" != "$3" ]; then echo "FAIL $1: $2 gave $code, want $3"; fail=1; return; fi
  if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -qi "^$4"; then echo "FAIL $1: $2 lacks $4"; fail=1; return; fi
  echo "ok   $1"
}
check "app root" / 200 "X-Content-Type-Options: nosniff"
check "client route" /tickets/12 200 "X-Frame-Options: DENY"
check "/assets refresh loads the app" /assets 200 "X-Frame-Options: DENY"
check "/assets/ refresh loads the app" /assets/ 200
check "hashed file" /assets/index-abc123.js 200 "Cache-Control: public, immutable"
check "hashed file keeps nosniff" /assets/index-abc123.js 200 "X-Content-Type-Options: nosniff"
check "missing hashed file is a 404" /assets/index-missing.js 404
exit $fail
